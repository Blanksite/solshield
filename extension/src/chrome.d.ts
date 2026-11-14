declare namespace chrome {
  namespace runtime {
    const id: string;
    interface MessageSender {
      tab?: { id?: number; url?: string };
      url?: string;
      origin?: string;
    }
    const onMessage: {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response?: unknown) => void
        ) => boolean | void
      ): void;
    };
    function getURL(path: string): string;
    function openOptionsPage(): Promise<void>;
    function sendMessage<T = unknown>(message: unknown): Promise<T>;
  }

  namespace storage {
    interface StorageChange {
      oldValue?: unknown;
      newValue?: unknown;
    }
    const local: {
      get<T = Record<string, unknown>>(
        keys?: string | string[] | Record<string, unknown> | null
      ): Promise<T>;
      set(items: Record<string, unknown>): Promise<void>;
      remove(keys: string | string[]): Promise<void>;
    };
    const onChanged: {
      addListener(
        callback: (
          changes: Record<string, StorageChange>,
          areaName: string
        ) => void
      ): void;
    };
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
      title?: string;
      active?: boolean;
    }
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
  }
}

declare module "*.png" {
  const src: string;
  export default src;
}
