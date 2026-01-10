"use client";

import { liveQuery } from "dexie";
import { useEffect, useState } from "react";

export function useLiveQueryState<T>(
  query: () => Promise<T>,
  deps: React.DependencyList,
  initial: T
) {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    const observable = liveQuery(query);
    const subscription = observable.subscribe({
      next: (result) => {
        setValue(result);
      },
      error: (error) => {
        console.error("LiveQuery error", error);
      }
    });

    return () => subscription.unsubscribe();
  }, deps);

  return value;
}
