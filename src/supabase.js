import { createClient } from '@supabase/supabase-js'

// --- KONFIGURASI SUPABASE ---
const SUPABASE_URL = 'https://woqqpmfqjvfuidumpddr.supabase.co'
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndvcXFwbWZxanZmdWlkdW1wZGRyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUxOTU3NTMsImV4cCI6MjA4MDc3MTc1M30.ZkCA0vKttpL1tl-eXhi4M_TtMv8ddgeMhmRAUlbgr8c'

// Buat client dan export agar bisa dipakai di App.vue
export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)