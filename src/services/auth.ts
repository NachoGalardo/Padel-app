import { supabase } from './supabase';

export type Gender = 'masculino' | 'femenino';
export type Level = '1' | '2' | '3' | '4' | '5' | '6' | '7' | '7B';

export interface SignUpPayload {
  email: string;
  password: string;
  displayName: string;
  phone: string;
  gender: Gender;
  level: Level;
  pushToken?: string;
  avatarUrl?: string;
}

export async function signUp(payload: SignUpPayload) {
  const { data, error } = await supabase.auth.signUp({
    email: payload.email,
    password: payload.password,
    options: {
      data: {
        display_name: payload.displayName,
        phone: payload.phone,
        gender: payload.gender,
        level: payload.level,
        push_token: payload.pushToken,
        avatar_url: payload.avatarUrl,
      },
    },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;
  return data.session;
}

export async function getProfile() {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('No hay sesión');
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).single();
  if (error) throw error;
  return data;
}

export async function updateProfile(fields: Partial<{ display_name: string; phone: string; gender: Gender; level: Level; push_token?: string; avatar_url?: string }>) {
  const user = (await supabase.auth.getUser()).data.user;
  if (!user) throw new Error('No hay sesión');
  if ('role' in fields) {
    throw new Error('El rol no puede modificarse desde cliente');
  }
  const { data, error } = await supabase.from('profiles').update(fields).eq('id', user.id).select('*').single();
  if (error) throw error;
  return data;
}

