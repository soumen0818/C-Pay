import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../services/supabase';
import { getCurrentUserCPayId } from '../utils/cpayId';
import { useFocusEffect } from '@react-navigation/native';
import React from 'react';
import { Logger } from '../utils/logger';

export const useProfileData = () => {
  const [walletAddress, setWalletAddress] = useState<string>('');
  const [cpayId, setCpayId] = useState<string>('');
  const [displayName, setDisplayName] = useState<string>('');
  const [profilePhoto, setProfilePhoto] = useState<string | null>(null);

  const loadWalletAddress = async () => {
    const address = await AsyncStorage.getItem('wallet_address');
    if (address) setWalletAddress(address);
  };

  const loadCPayId = async () => {
    const id = await getCurrentUserCPayId();
    if (id) setCpayId(id);
  };

  const loadDisplayName = async () => {
    try {
      const address = await AsyncStorage.getItem('wallet_address');
      if (!address) return;

      const { data, error } = await supabase
        .from('users')
        .select('display_name')
        .eq('wallet_address', address)
        .single();

      if (!error && data?.display_name) {
        setDisplayName(data.display_name);
        await AsyncStorage.setItem('display_name', data.display_name);
      } else {
        const localName = await AsyncStorage.getItem('display_name');
        if (localName) setDisplayName(localName);
      }
    } catch (error) {
      Logger.error('Error loading display name:', error);
      const localName = await AsyncStorage.getItem('display_name');
      if (localName) setDisplayName(localName);
    }
  };

  const loadProfilePhoto = async () => {
    try {
      const address = await AsyncStorage.getItem('wallet_address');
      if (!address) return;

      const { data, error } = await supabase
        .from('users')
        .select('profile_photo_url')
        .eq('wallet_address', address)
        .single();

      if (!error && data?.profile_photo_url) {
        setProfilePhoto(data.profile_photo_url);
      } else {
        const localPhoto = await AsyncStorage.getItem('profile_photo');
        if (localPhoto) setProfilePhoto(localPhoto);
      }
    } catch (error) {
      Logger.error('Error loading profile photo:', error);
    }
  };

  useEffect(() => {
    loadWalletAddress();
    loadCPayId();
    loadDisplayName();
    loadProfilePhoto();
  }, []);

  useFocusEffect(
    React.useCallback(() => {
      loadCPayId();
      loadDisplayName();
      loadProfilePhoto();
    }, [])
  );

  const uploadProfilePhoto = async (photoUri: string): Promise<string | null> => {
    try {
      const address = await AsyncStorage.getItem('wallet_address');
      if (!address) return null;

      const base64 = await fetch(photoUri)
        .then(res => res.blob())
        .then(blob => {
          return new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64data = reader.result as string;
              resolve(base64data.split(',')[1]);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        });

      const fileExt = photoUri.split('.').pop()?.split('?')[0] || 'jpg';
      const fileName = `${address.substring(0, 8)}_${Date.now()}.${fileExt}`;
      const filePath = `profile-photos/${fileName}`;

      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const { error: uploadError } = await supabase.storage
        .from('profile-images')
        .upload(filePath, bytes.buffer, {
          contentType: `image/${fileExt}`,
          upsert: true,
        });

      if (uploadError) {
        Logger.error('Upload error details:', uploadError);
        return null;
      }

      const { data: urlData } = supabase.storage
        .from('profile-images')
        .getPublicUrl(filePath);

      const publicUrl = urlData.publicUrl;

      const { error: dbError } = await supabase
        .from('users')
        .update({ profile_photo_url: publicUrl })
        .eq('wallet_address', address);

      if (dbError) Logger.error('Database update error:', dbError);

      await AsyncStorage.setItem('profile_photo', publicUrl);
      return publicUrl;
    } catch (error) {
      Logger.error('Error uploading profile photo:', error);
      return null;
    }
  };

  return {
    walletAddress,
    cpayId,
    displayName,
    profilePhoto,
    setProfilePhoto,
    uploadProfilePhoto,
  };
};
