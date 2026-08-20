import type { ColorValue } from "react-native";
import Svg, { Path } from "react-native-svg";

/**
 * The "MT" brand mark, matching the desktop sidebar's MTWordmark SVG
 * (apps/web SidebarChrome.tsx). Width derives from the viewBox aspect ratio.
 */
export function MTWordmark(props: { readonly height: number; readonly color: ColorValue }) {
  const aspectRatio = 725 / 657;
  return (
    <Svg
      accessibilityLabel="MT"
      height={props.height}
      width={props.height * aspectRatio}
      viewBox="0 0 725 657"
    >
      <Path
        d="M52.55 87.88L52.71 88.31L51.91 88.23L-0.00 603.93L105.52 614.54L135.85 313.36L180.70 434.81L181.21 439.26L182.29 439.14L184.07 443.91L265.79 413.73L273.57 383.74L293.72 313.04L312.99 481.66L219.10 524.02L180.96 657.00L668.78 436.99L668.19 435.67L631.01 110.43L725.00 105.25L719.20 0.00L419.05 16.55L424.86 121.80L525.04 116.27L554.38 372.82L413.31 436.42L366.62 27.95L262.49 39.87L262.94 43.85L212.90 219.50L150.87 51.56Z"
        fill={props.color}
      />
    </Svg>
  );
}
