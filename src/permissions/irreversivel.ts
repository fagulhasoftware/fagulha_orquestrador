// Heuristica para comandos conhecidos. Nao interpreta scripts nem garante isolamento.
export function irreversivelExterno(comando: string): boolean {
  const c = comando.replace(/["']/g, '');
  if (
    /\bgit\b[^;&|\r\n]*\bpush\b[^;&|\r\n]*(?:--force(?:-with-lease)?\b|(?:^|\s)-f(?:\s|$)|--delete\b|\s:[\w/.-]+)/i.test(
      c,
    )
  )
    return true;
  if (
    /\bgh\s+(?:repo|release)\s+delete\b|\b(?:gcloud|oci|az)\b[^;&|\r\n]*\b(?:delete|terminate)\b|\baws\b[^;&|\r\n]*(?:\bdelete-[\w-]+|\bterminate-instances\b|\bs3\s+rb\b)|\bterraform\s+(?:destroy\b|apply\b[^;&|\r\n]*-destroy\b)|\bkubectl\b[^;&|\r\n]*\bdelete\s+(?:namespace|namespaces|ns|cluster|pv|persistentvolume)\b|\bsupabase\s+(?:db\s+reset|projects\s+delete)\b|\bvercel\s+remove\b|\bnetlify\s+sites:delete\b|\bfly\s+apps\s+destroy\b/i.test(
      c,
    )
  )
    return true;
  const sql =
    /\bDROP\s+(?:DATABASE|SCHEMA|TABLE)\b|\bTRUNCATE\b/i.test(c) ||
    c.split(';').some((s) => /\bDELETE\s+FROM\b/i.test(s) && !/\bWHERE\b/i.test(s));
  if (!sql || !/\b(?:psql|mysql|supabase)\b/i.test(c)) return false;
  const hosts = [
    ...c.matchAll(
      /(?:postgres(?:ql)?|mysql):\/\/(?:[^\s/@]+@)?(\[[^\]]+\]|[^\s/:?]+)|(?:--host(?:=|\s+)|-h\s+)([^\s;]+)/gi,
    ),
  ].map((m) => m[1] ?? m[2]);
  return hosts.some((h) => !/^(?:localhost|127(?:\.\d+){3}|\[?::1\]?)$/i.test(h));
}
