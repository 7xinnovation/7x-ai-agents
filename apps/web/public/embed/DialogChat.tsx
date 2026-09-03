/**
 * The Dialog assistant, inside a React Native app.
 *
 * This is a WEBVIEW WRAPPER, not a second chat. It loads the same widget the
 * website loads — same conversation, same journeys, same fixes — so nothing here
 * has to be kept in step with it.
 *
 * What the wrapper is for is the handful of things a WebView cannot do on its
 * own. The conversation opens a payment page, a sign-in page and, on Android, a
 * file picker; a WebView answers `window.open` with null, and the widget's
 * browser fallback would replace the conversation with a payment page and leave
 * no way back to it. So the page asks the host to open those, and the host tells
 * it when the customer returns.
 *
 * Install:
 *   npx expo install react-native-webview expo-web-browser
 *   (bare RN: npm i react-native-webview && npx pod-install)
 *
 * Use:
 *   <DialogChat
 *     host="https://agent.7x.ae"
 *     agent="nxn-dialog"
 *     locale="en"
 *     accessToken={session.accessToken}   // the customer's Emirates Post token
 *   />
 *
 * PERMISSIONS. The conversation can pin an address on a map and take a spoken
 * message, so add what you use:
 *   ios/Info.plist        NSLocationWhenInUseUsageDescription
 *                         NSMicrophoneUsageDescription
 *                         NSCameraUsageDescription        (photo of a document)
 *                         NSPhotoLibraryUsageDescription
 *   AndroidManifest.xml   ACCESS_FINE_LOCATION, RECORD_AUDIO, CAMERA
 * Without them those steps degrade — the customer types the address instead —
 * rather than failing.
 */
import React, { useCallback, useRef, useState } from "react";
import {
  ActivityIndicator,
  BackHandler,
  Platform,
  StyleSheet,
  View,
  type ViewStyle,
} from "react-native";
import { WebView, type WebViewMessageEvent, type WebViewNavigation } from "react-native-webview";
import * as WebBrowser from "expo-web-browser";

export interface DialogChatProps {
  /** Where the assistant is hosted, e.g. "https://agent.7x.ae". No trailing slash needed. */
  host: string;
  /** The agent slug, e.g. "nxn-dialog". */
  agent: string;
  /** "en" or "ar". Defaults to the agent's first locale. */
  locale?: "en" | "ar";
  /**
   * The customer's Emirates Post access token.
   *
   * The web widget reads this from the page's own storage; an app has it already,
   * so pass it and the conversation starts signed in. Leave it out and the
   * customer is treated as a guest, which is a supported path, not a failure.
   */
  accessToken?: string;
  /** Resume a conversation the customer already had. */
  conversationId?: string;
  style?: ViewStyle;
  /** Called when the customer completes a purchase, with its reference. */
  onCompleted?: (reference: string) => void;
}

interface NativeMessage {
  source?: string;
  action?: string;
  kind?: string;
  url?: string;
  reference?: string;
}

export function DialogChat({
  host,
  agent,
  locale,
  accessToken,
  conversationId,
  style,
  onCompleted,
}: DialogChatProps) {
  const ref = useRef<WebView>(null);
  const [loading, setLoading] = useState(true);
  const canGoBack = useRef(false);

  const base = host.replace(/\/$/, "");
  const params = new URLSearchParams({ embedded: "1" });
  if (locale) params.set("locale", locale);
  if (accessToken) params.set("upt", accessToken);
  if (conversationId) params.set("cid", conversationId);
  const uri = `${base}/embed/${encodeURIComponent(agent)}?${params.toString()}`;

  /** Tell the page something happened out here. */
  const notify = useCallback((detail: Record<string, unknown>) => {
    ref.current?.injectJavaScript(
      `window.dispatchEvent(new CustomEvent('dialog-native',{detail:${JSON.stringify(detail)}}));true;`
    );
  }, []);

  const onMessage = useCallback(
    async (event: WebViewMessageEvent) => {
      let msg: NativeMessage;
      try {
        msg = JSON.parse(event.nativeEvent.data) as NativeMessage;
      } catch {
        return; // not ours
      }
      if (msg.source !== "dialog-native") return;

      if (msg.action === "open-url" && msg.url) {
        // An in-app browser, not a new app: the customer stays inside your app,
        // keeps their session, and comes straight back to the conversation.
        try {
          await WebBrowser.openBrowserAsync(msg.url, {
            // A payment page they can dismiss, over the chat.
            presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
            dismissButtonStyle: "close",
          });
        } catch {
          // Nothing opened. The conversation must still hear about it, or its
          // button sits on "opening…" for good.
        }
        // openBrowserAsync resolves when it closes. Whether they paid is not ours
        // to judge: the conversation asks the backend, which is the only thing
        // that knows.
        notify({ action: "returned", url: msg.url });
        return;
      }

      // Fired once, when the backend has actually recorded the request -- not
      // when the payment sheet closes, which says nothing about whether it worked.
      if (msg.action === "completed" && msg.reference) onCompleted?.(msg.reference);
    },
    [notify, onCompleted]
  );

  // Android's hardware back should walk the conversation back before it leaves.
  React.useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!canGoBack.current) return false;
      ref.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  const onNavigationStateChange = useCallback((nav: WebViewNavigation) => {
    canGoBack.current = nav.canGoBack;
  }, []);

  /**
   * Keep the conversation in this WebView.
   *
   * Anything that is not the assistant — a payment page reached some other way, a
   * link in an answer — opens outside it. Navigating away from here loses the
   * conversation, which is the one thing that must not happen.
   */
  const onShouldStartLoadWithRequest = useCallback(
    (req: WebViewNavigation) => {
      if (req.url.startsWith(base) || req.url.startsWith("about:") || req.url.startsWith("data:")) return true;
      void WebBrowser.openBrowserAsync(req.url).then(() => notify({ action: "returned", url: req.url }));
      return false;
    },
    [base, notify]
  );

  return (
    <View style={[styles.fill, style]}>
      <WebView
        ref={ref}
        source={{ uri }}
        style={styles.fill}
        originWhitelist={[`${base}/*`]}
        onMessage={onMessage}
        onNavigationStateChange={onNavigationStateChange}
        onShouldStartLoadWithRequest={onShouldStartLoadWithRequest}
        onLoadEnd={() => setLoading(false)}
        // window.open must NOT open a second WebView we do not control; the page
        // detects that and asks us instead.
        setSupportMultipleWindows={false}
        javaScriptEnabled
        domStorageEnabled
        // Uploading a document, and photographing one.
        allowFileAccess
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        // Pinning an address, and speaking a message. iOS asks once; Android
        // needs the manifest permissions listed at the top of this file.
        geolocationEnabled
        mediaCapturePermissionGrantType="grantIfSameHostElsePrompt"
        // Their payment page and the survey both set cookies.
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        // A rented PO Box is not something to lose to a stale page.
        cacheEnabled={false}
        pullToRefreshEnabled={false}
        keyboardDisplayRequiresUserAction={false}
      />
      {loading ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="large" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, backgroundColor: "transparent" },
  loading: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center" },
});

export default DialogChat;
