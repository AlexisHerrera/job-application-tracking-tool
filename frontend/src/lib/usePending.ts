import { useRef, useState } from "react";

export function usePending<Key extends string>() {
  const active = useRef<Key | null>(null);
  const [pending, setPending] = useState<Key | null>(null);

  async function run<T>(key: Key, work: () => Promise<T>) {
    if (active.current !== null) return;
    active.current = key;
    setPending(key);
    try {
      return await work();
    } finally {
      active.current = null;
      setPending(null);
    }
  }

  return { pending, run };
}
