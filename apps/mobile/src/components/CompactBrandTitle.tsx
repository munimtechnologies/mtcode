import Constants from "expo-constants";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { Platform, View } from "react-native";
import { AppText as Text } from "./AppText";
import { BrandWordmark } from "./BrandWordmark";
import { IPAD_HOME_TITLE_OFFSET } from "../lib/layoutMetrics";
import { getBrandLabel, getProductName } from "../lib/branding";
import { resolveMobileStageLabel } from "../lib/mobileBranding";
import { useUniwindTheme } from "../lib/useUniwindTheme";

/**
 * Horizontal correction applied to content rendered in the brand title slot,
 * shared with the connection-status swap so both align identically.
 */
export function brandTitleOffset(): number {
  if (Platform.OS !== "ios") return 0;
  return Platform.isPad ? IPAD_HOME_TITLE_OFFSET : 0;
}

/**
 * Compact brand lockup sized for native navigation bars.
 */
export function CompactBrandTitle(
  props: {
    readonly allowFontScaling?: boolean;
  } = {},
) {
  const stageLabel = resolveMobileStageLabel(Constants.expoConfig?.extra?.appVariant);
  const titleOffset = brandTitleOffset();
  const productName = getProductName();
  const brandLabel = getBrandLabel();
  const iconColor = useUniwindTheme()["--color-icon"];

  return (
    <View
      aria-level={1}
      accessibilityLabel={`${productName}, Threads`}
      accessible
      role="heading"
      className="flex-row items-center gap-1.5"
      style={{ marginLeft: titleOffset }}
    >
      <BrandWordmark color={iconColor} height={15} />
      <Text
        allowFontScaling={props.allowFontScaling}
        className="font-t3-medium text-[21px] tracking-[-0.5px] text-foreground-muted"
      >
        {brandLabel}
      </Text>
      <View className="rounded-full bg-subtle px-1.5 py-0.5">
        <Text
          allowFontScaling={props.allowFontScaling}
          className="font-t3-bold text-[9px] tracking-[0.9px] text-foreground-muted uppercase"
        >
          {stageLabel}
        </Text>
      </View>
    </View>
  );
}

export function renderCompactBrandTitle() {
  return <CompactBrandTitle allowFontScaling={Platform.OS === "ios"} />;
}

export function getCompactBrandHeaderOptions(
  fallbackTitleStyle?: NativeStackNavigationOptions["headerTitleStyle"],
): NativeStackNavigationOptions {
  return {
    headerTitle: renderCompactBrandTitle,
    headerTitleStyle: fallbackTitleStyle,
    title: "Threads",
    unstable_headerLeftItems: undefined,
  };
}
