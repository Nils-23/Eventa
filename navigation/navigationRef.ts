/**
 * Root navigation ref — lets code outside the navigation tree (root-level
 * overlays like the creator welcome modal) trigger navigation. Attach the ref
 * to the NavigationContainer in App.tsx.
 */
import { createNavigationContainerRef } from '@react-navigation/native';

export const navigationRef = createNavigationContainerRef();

export function navigate(name: string, params?: object) {
  if (navigationRef.isReady()) {
    // Ref is untyped (no root param list), so navigate's overloads resolve to
    // `never`; cast through to call it by screen name.
    (navigationRef.navigate as (n: string, p?: object) => void)(name, params);
  }
}
