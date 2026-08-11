/**
 * EdgeSwipeBack
 *
 * Gives Android a swipe-from-the-left-edge to go back. React Navigation's
 * native-stack implements `gestureEnabled` on iOS ONLY ("@platform ios" in its
 * types), so on Android that option is a no-op and users are left with the system
 * back gesture — which doesn't exist at all for anyone on 3-button navigation.
 *
 * Two design constraints drove the implementation:
 *
 *  1. STRICTLY EDGE-ONLY. The gesture must start inside EDGE_WIDTH of the left
 *     edge. A back swipe that fires from anywhere on screen pops the page on any
 *     stray horizontal drag, which is the exact complaint this replaces.
 *
 *  2. IT MUST NOT SWALLOW TOUCHES. An absolutely-positioned overlay strip would
 *     be the obvious approach, but in React Native the responder negotiation only
 *     walks the hit view and its ANCESTORS — never siblings underneath. So an
 *     overlay eats every tap in its band even when it declines the gesture. (This
 *     is exactly the bug that made VenueChat's camera button unresponsive on its
 *     left half.) Instead this wraps the screen, making it an ancestor: it stays
 *     out of the way on touch-down and only claims the gesture, via the capture
 *     phase, once the finger has moved horizontally from the edge.
 */
import React, { useRef } from 'react';
import { View, PanResponder, Platform, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';

// How close to the left edge a gesture must START. Deliberately narrow so it
// can't be triggered by ordinary content drags.
const EDGE_WIDTH = 25;
// Horizontal travel before we take over. Above the noise of a tap.
const ACTIVATE_DX = 12;
// The swipe must be decisively horizontal, or a diagonal scroll would trigger it.
const HORIZONTAL_RATIO = 2;
// Travel required on release to actually pop.
const COMMIT_DX = 60;

export const EdgeSwipeBack: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const navigation = useNavigation<any>();

  // Ref so the responder (created once) always reads current navigation state.
  const navRef = useRef(navigation);
  navRef.current = navigation;

  const panResponder = useRef(
    PanResponder.create({
      // Never claim on touch-down: taps, presses and scroll starts must pass
      // through to the screen's own content untouched.
      onStartShouldSetPanResponder: () => false,
      onStartShouldSetPanResponderCapture: () => false,

      // Capture phase so we can take the gesture from a ScrollView/FlatList that
      // has already started handling it — but only under the strict conditions
      // below, so normal scrolling is never stolen.
      onMoveShouldSetPanResponderCapture: (evt, g) => {
        if (!navRef.current?.canGoBack?.()) return false; // nothing to pop (e.g. root tabs)
        // pageX is the CURRENT position; subtracting dx recovers where the finger
        // first touched down, which is what has to be near the edge.
        const startX = evt.nativeEvent.pageX - g.dx;
        return (
          startX <= EDGE_WIDTH &&
          g.dx > ACTIVATE_DX &&
          Math.abs(g.dx) > Math.abs(g.dy) * HORIZONTAL_RATIO
        );
      },

      onPanResponderRelease: (_, g) => {
        if (g.dx > COMMIT_DX && navRef.current?.canGoBack?.()) {
          navRef.current.goBack();
        }
      },
    })
  ).current;

  // iOS already has the real interactive edge gesture from native-stack; layering
  // ours on top would fight it.
  if (Platform.OS !== 'android') return <>{children}</>;

  return (
    <View style={styles.fill} {...panResponder.panHandlers}>
      {children}
    </View>
  );
};

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
