-- SYNTHETIC DATA ONLY. Run once on a newly initialized, empty staging project.
-- Within a transaction, first set lovecapsule.test_password to a disposable
-- password of at least 16 characters. Never use a real account password.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM auth.users) OR EXISTS (SELECT 1 FROM public.profiles) THEN
    RAISE EXCEPTION 'Staging seed requires an empty Auth and profiles database';
  END IF;
  IF length(COALESCE(current_setting('lovecapsule.test_password', true), '')) < 16 THEN
    RAISE EXCEPTION 'Set a disposable staging password of at least 16 characters';
  END IF;
END $$;

INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change, email_change_token_new)
SELECT '00000000-0000-0000-0000-000000000000', id, 'authenticated', 'authenticated', email,
  extensions.crypt(current_setting('lovecapsule.test_password'), extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}'::jsonb,
  jsonb_build_object('display_name', name), now(), now(), '', '', '', ''
FROM (VALUES
  ('aa000000-0000-4000-8000-000000000001'::uuid, 'alex@lovecapsule.test', 'Alex'),
  ('aa000000-0000-4000-8000-000000000002'::uuid, 'sam@lovecapsule.test', 'Sam')
) AS accounts(id, email, name);
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
SELECT gen_random_uuid(), id::text, id, jsonb_build_object('sub', id::text, 'email', email,
  'email_verified', true, 'phone_verified', false), 'email', now(), now(), now()
FROM auth.users WHERE email IN ('alex@lovecapsule.test', 'sam@lovecapsule.test');

INSERT INTO public.couples(id, partner_1_id, partner_2_id)
VALUES ('cc000000-0000-4000-8000-000000000001',
  'aa000000-0000-4000-8000-000000000001', 'aa000000-0000-4000-8000-000000000002');

INSERT INTO public.entries(couple_id, author_id, title, content_plain, content_html, word_count,
  mood, is_draft, entry_date, created_at)
SELECT 'cc000000-0000-4000-8000-000000000001', author,
  (ARRAY['A letter for a rainy day', 'Our slow Sunday', 'The little things', 'A weekend by the sea', 'Coffee and a long walk', 'One of my favorite days'])[1 + (i - 1) % 6] || CASE WHEN i > 6 THEN ' · ' || i ELSE '' END,
  'Today we took the long way home and found a new favorite place. I want to remember the conversation, the laughter, and how easy it felt to be together.' || E'\n\n' ||
  'This is a synthetic memory for checking LoveCapsule layouts. ' || repeat('There is always another little moment worth keeping. ', i % 5),
  '<p>A synthetic memory, saved with love.</p>', 54 + (i % 5) * 9,
  (ARRAY['loving', 'happy', 'grateful', 'adventurous', 'peaceful', 'cozy'])[1 + (i - 1) % 6],
  i = 1, current_date - i + 1, now() - i * interval '1 day'
FROM generate_series(1, 60) AS series(i)
CROSS JOIN (VALUES ('aa000000-0000-4000-8000-000000000001'::uuid),
  ('aa000000-0000-4000-8000-000000000002'::uuid)) AS authors(author);

SELECT set_config('request.jwt.claim.sub', 'aa000000-0000-4000-8000-000000000001', true);
SELECT public.save_annual_schedule('cc000000-0000-4000-8000-000000000001', 1,
  (now() AT TIME ZONE 'America/Los_Angeles' + interval '1 minute')::date,
  (now() AT TIME ZONE 'America/Los_Angeles' + interval '1 minute')::time(0), 'America/Los_Angeles');
SELECT public.save_checkpoint_schedule('cc000000-0000-4000-8000-000000000001', null, null,
  jsonb_build_object('frequency', 'specific_date', 'specific_date', current_date - 1,
    'reveal_time', '12:00', 'timezone', 'America/Los_Angeles', 'is_active', true, 'label', 'A little surprise'));
SELECT public.save_checkpoint_schedule('cc000000-0000-4000-8000-000000000001', null, null,
  jsonb_build_object('frequency', 'specific_date', 'specific_date', current_date + 1,
    'reveal_time', '19:30', 'timezone', 'America/Los_Angeles', 'is_active', true, 'label', 'Just because'));
SELECT public.save_checkpoint_schedule('cc000000-0000-4000-8000-000000000001', null, null,
  '{"frequency":"monthly","day_of_month":31,"reveal_time":"19:30","timezone":"America/Los_Angeles","is_active":true,"label":"Our monthly peek"}');
