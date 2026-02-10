import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import type { Couple, Profile } from '../types/database';
import { getDaysUntilAnniversary, isAnniversaryReady } from '../lib/date-utils';

interface UseCoupleReturn {
  couple: Couple | null;
  partner: Profile | null;
  loading: boolean;
  error: string | null;
  daysUntilAnniversary: number | null;
  isRevealReady: boolean;
  isRevealed: boolean;
  createCouple: () => Promise<string>;
  joinCouple: (inviteCode: string) => Promise<void>;
  setAnniversaryDate: (date: string) => Promise<void>;
  unpairCouple: () => Promise<void>;
  refresh: () => Promise<void>;
}

export function useCouple(): UseCoupleReturn {
  const { user } = useAuth();
  const [couple, setCouple] = useState<Couple | null>(null);
  const [partner, setPartner] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCouple = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }

    try {
      const { data, error: fetchError } = await supabase
        .from('couples')
        .select('*')
        .or(`partner_1_id.eq.${user.id},partner_2_id.eq.${user.id}`)
        .maybeSingle();

      if (fetchError) throw fetchError;

      setCouple(data);

      if (data) {
        const partnerId = data.partner_1_id === user.id ? data.partner_2_id : data.partner_1_id;
        if (partnerId) {
          const { data: partnerData } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', partnerId)
            .single();
          setPartner(partnerData);
        }
      }
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchCouple();
  }, [fetchCouple]);

  const createCouple = async (): Promise<string> => {
    if (!user) throw new Error('Not authenticated');
    if (couple) throw new Error('You already have a couple');

    const { data, error: createError } = await supabase
      .from('couples')
      .insert({ partner_1_id: user.id })
      .select()
      .single();

    if (createError) throw createError;
    setCouple(data);
    return data.invite_code;
  };

  const joinCouple = async (inviteCode: string) => {
    if (!user) throw new Error('Not authenticated');

    // If the user previously created an empty couple (no partner joined),
    // delete it before joining the other couple.
    if (couple && !couple.partner_2_id && couple.partner_1_id === user.id) {
      await supabase.from('couples').delete().eq('id', couple.id);
    }

    const { data, error: joinError } = await supabase
      .from('couples')
      .update({ partner_2_id: user.id })
      .eq('invite_code', inviteCode.trim().toLowerCase())
      .is('partner_2_id', null)
      .select()
      .single();

    if (joinError || !data) {
      throw new Error('Invalid invite code or couple already full');
    }

    await fetchCouple();
  };

  const setAnniversaryDate = async (date: string) => {
    if (!couple) throw new Error('No couple found');

    const { error: updateError } = await supabase
      .from('couples')
      .update({ anniversary_date: date })
      .eq('id', couple.id);

    if (updateError) throw updateError;
    await fetchCouple();
  };

  const unpairCouple = async () => {
    if (!couple) throw new Error('No couple to unpair');
    if (!user) throw new Error('Not authenticated');

    // Step 1: Get all entries for this couple to find media paths
    const { data: entries } = await supabase
      .from('entries')
      .select('id')
      .eq('couple_id', couple.id);

    // Step 2: Delete media files from Supabase Storage
    if (entries && entries.length > 0) {
      const entryIds = entries.map((e) => e.id);
      const { data: mediaFiles } = await supabase
        .from('media')
        .select('storage_path, author_id')
        .in('entry_id', entryIds);

      if (mediaFiles && mediaFiles.length > 0) {
        // Delete storage files (each user's files are in their folder)
        const filePaths = mediaFiles.map((m) => `${m.author_id}/${m.storage_path}`);
        await supabase.storage.from('entry-media').remove(filePaths);
      }
    }

    // Step 3: Delete the couple (cascades to entries, media rows, reveal_history)
    const { error: deleteError } = await supabase.from('couples').delete().eq('id', couple.id);

    if (deleteError) throw deleteError;

    // Step 4: Clear local state
    setCouple(null);
    setPartner(null);
  };

  const daysUntilAnniversary = couple?.anniversary_date
    ? getDaysUntilAnniversary(couple.anniversary_date)
    : null;

  const isRevealReady = couple?.anniversary_date
    ? isAnniversaryReady(couple.anniversary_date, couple.last_reveal_year)
    : false;

  // is_revealed stays true after a reveal has been triggered for the current year
  const isRevealed = couple?.is_revealed === true;

  return {
    couple,
    partner,
    loading,
    error,
    daysUntilAnniversary,
    isRevealReady,
    isRevealed,
    createCouple,
    joinCouple,
    setAnniversaryDate,
    unpairCouple,
    refresh: fetchCouple,
  };
}
