import { createClient } from "@supabase/supabase-js";
import AsyncStorage from "@react-native-async-storage/async-storage";

const supabaseUrl = "https://neorbblppjpxddldjkwn.supabase.co";
const supabaseAnonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5lb3JiYmxwcGpweGRkbGRqa3duIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzMjM0MTcsImV4cCI6MjA5Nzg5OTQxN30.68dE_jtnpgx3YaZR6Z2oIJFt_KC9uYnSUuOWg37eG6k";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export async function signInWithEmail(email) {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: "gotogether://",
    },
  });
  return error;
}
