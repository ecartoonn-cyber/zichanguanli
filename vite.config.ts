import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

function isPrivilegedKey(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  const encodedPayload = value.split('.')[1];
  if (!encodedPayload) return false;
  try {
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '='))) as { role?: string };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}

export default defineConfig(({ mode }) => {
  const buildEnv = loadEnv(mode, '.', '');
  const unsafePublicKeys = Object.keys(buildEnv).filter((key) =>
    /^(VITE_|NEXT_PUBLIC_).*(SERVICE_ROLE|POSTGRES|DATABASE|PASSWORD|SECRET)/i.test(key),
  );
  const supabaseUrl = buildEnv.NEXT_PUBLIC_SUPABASE_URL || buildEnv.VITE_SUPABASE_URL || buildEnv.SUPABASE_URL || '';
  const anonKey = buildEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY || buildEnv.VITE_SUPABASE_ANON_KEY || buildEnv.SUPABASE_ANON_KEY || '';
  if (anonKey && isPrivilegedKey(anonKey)) unsafePublicKeys.push('SUPABASE_ANON_KEY (contains a privileged service-role token)');
  if (unsafePublicKeys.length > 0) {
    throw new Error(`Refusing to expose privileged environment variables to browser build: ${unsafePublicKeys.join(', ')}`);
  }

  return {
    plugins: [react()],
    // Only VITE_ values are generally browser-visible. Supabase configuration
    // is explicitly mapped below; database and service-role values stay server-side.
    envPrefix: ['VITE_'],
    define: {
      'import.meta.env.NEXT_PUBLIC_SUPABASE_URL': JSON.stringify(supabaseUrl),
      'import.meta.env.NEXT_PUBLIC_SUPABASE_ANON_KEY': JSON.stringify(anonKey),
      'import.meta.env.NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED': JSON.stringify(buildEnv.NEXT_PUBLIC_SUPABASE_SIGNUP_ENABLED || 'false'),
    },
    test: {
      environment: 'node',
      include: ['src/**/*.test.ts'],
    },
  };
});
