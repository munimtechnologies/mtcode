import type { ColorValue } from "react-native";

import { getBrandMark, isMunimDistro } from "../lib/branding";
import { MTWordmark } from "./MTWordmark";
import { T3Wordmark } from "./T3Wordmark";
import { AppText as Text } from "./AppText";

/**
 * Distro-aware wordmark for navigation headers: MT SVG, T3 SVG, or plain text
 * for any other first-word mark.
 */
export function BrandWordmark(props: { readonly height: number; readonly color: ColorValue }) {
  if (isMunimDistro()) {
    return <MTWordmark color={props.color} height={props.height} />;
  }
  const mark = getBrandMark();
  if (mark !== "T3") {
    return (
      <Text
        accessibilityLabel={mark}
        style={{
          color: props.color,
          fontFamily: "DMSans-Bold",
          fontSize: props.height,
          letterSpacing: -0.4,
          lineHeight: props.height + 2,
        }}
      >
        {mark}
      </Text>
    );
  }
  return <T3Wordmark color={props.color} height={props.height} />;
}
