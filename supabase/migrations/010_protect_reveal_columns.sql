-- ============================================
-- PROTECT REVEAL / PAIRING COLUMNS (audit C3)
-- ============================================
-- "Couple members can update" allows an unrestricted UPDATE on every
-- column of couples, so either partner could simply write
-- last_reveal_year (the gate that migration 009 made authoritative for
-- partner visibility) and read the other's sealed entries early. The
-- same hole let a member rewrite invite_code or swap partner ids.
--
-- RLS cannot express "these columns are read-only", so a BEFORE trigger
-- rejects the writes instead. Triggers run as the calling role, so
-- SECURITY DEFINER functions (join_couple_by_code, dev_set_reveal_state)
-- and the service role used by the check-anniversary edge function pass
-- through untouched, while the app's authenticated/anon roles cannot.
--
-- anniversary_date is deliberately NOT protected: both partners set it
-- legitimately from Settings.
--
-- Dev tooling: the in-app Force/Reset Reveal buttons wrote these columns
-- directly. They now go through dev_set_reveal_state, which requires
-- profiles.is_admin — a flag only settable from the Supabase dashboard
-- (see the profiles trigger below), never by the app. That keeps the
-- reveal flow testable in any build, including TestFlight, without
-- reopening the hole for anyone else.

-- ============================================
-- Admin flag
-- ============================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_admin BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.is_admin IS
  'Grants access to in-app dev tools. Only settable via the Supabase '
  'dashboard / service role — the app cannot set it (see '
  'protect_profile_columns).';

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((SELECT is_admin FROM public.profiles WHERE id = auth.uid()), false)
$$;

REVOKE EXECUTE ON FUNCTION public.is_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;

-- ============================================
-- Guard: couples reveal/pairing columns
-- ============================================

CREATE OR REPLACE FUNCTION public.protect_couple_columns()
RETURNS TRIGGER AS $$
BEGIN
  -- Only constrain the roles PostgREST uses for app traffic.
  IF current_user IN ('authenticated', 'anon') THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.is_revealed IS DISTINCT FROM OLD.is_revealed
       OR NEW.last_reveal_year IS DISTINCT FROM OLD.last_reveal_year
       OR NEW.partner_1_id IS DISTINCT FROM OLD.partner_1_id
       OR NEW.partner_2_id IS DISTINCT FROM OLD.partner_2_id
       OR NEW.invite_code IS DISTINCT FROM OLD.invite_code
    THEN
      RAISE EXCEPTION
        'Reveal state and pairing columns cannot be modified directly'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS protect_couple_columns_trigger ON public.couples;
CREATE TRIGGER protect_couple_columns_trigger
  BEFORE UPDATE ON public.couples
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_couple_columns();

-- ============================================
-- Guard: profiles.is_admin (no self-elevation)
-- ============================================

CREATE OR REPLACE FUNCTION public.protect_profile_columns()
RETURNS TRIGGER AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    IF TG_OP = 'INSERT' THEN
      -- A client-created profile is never an admin, whatever it asked for.
      NEW.is_admin := false;
    ELSIF NEW.is_admin IS DISTINCT FROM OLD.is_admin
          OR NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'This profile column cannot be modified directly'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS protect_profile_columns_trigger ON public.profiles;
CREATE TRIGGER protect_profile_columns_trigger
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_columns();

-- ============================================
-- Admin-only reveal override (in-app dev tools)
-- ============================================
-- Replaces the direct couples UPDATE the Force/Reset Reveal buttons used
-- to run. Requires couple membership AND is_admin.

CREATE OR REPLACE FUNCTION public.dev_set_reveal_state(
  p_couple_id UUID,
  p_last_reveal_year INT DEFAULT NULL,
  p_is_revealed BOOLEAN DEFAULT NULL
)
RETURNS public.couples AS $$
DECLARE
  v_couple public.couples;
BEGIN
  PERFORM public.assert_couple_member(p_couple_id);

  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Admin access required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.couples
     SET last_reveal_year = p_last_reveal_year,
         is_revealed = COALESCE(p_is_revealed, p_last_reveal_year IS NOT NULL),
         updated_at = now()
   WHERE id = p_couple_id
  RETURNING * INTO v_couple;

  RETURN v_couple;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

REVOKE EXECUTE ON FUNCTION public.dev_set_reveal_state(uuid, int, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dev_set_reveal_state(uuid, int, boolean)
  TO authenticated, service_role;
