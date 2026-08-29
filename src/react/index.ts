import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";

import type {
  RendererStore,
  RendererStoreDefinition,
} from "../electron-renderer/types.js";
import type { DeepReadonly } from "../wire/types.js";

type StoreState<Definition extends RendererStoreDefinition> = DeepReadonly<
  Definition["initialState"]
>;

export function useStore<Definition extends RendererStoreDefinition>(
  store: RendererStore<Definition>,
): StoreState<Definition>;

export function useStore<
  Definition extends RendererStoreDefinition,
  Selected,
>(
  store: RendererStore<Definition>,
  selector: (state: StoreState<Definition>) => Selected,
  isEqual?: (left: Selected, right: Selected) => boolean,
): Selected;

export function useStore<
  Definition extends RendererStoreDefinition,
  Selected = StoreState<Definition>,
>(
  store: RendererStore<Definition>,
  selector?: (state: StoreState<Definition>) => Selected,
  isEqual: (left: Selected, right: Selected) => boolean = Object.is,
): Selected {
  const select = selector ?? ((state: StoreState<Definition>) => state as Selected);
  return useSyncExternalStoreWithSelector(
    store.subscribe,
    store.getState,
    store.getState,
    select,
    isEqual,
  );
}
