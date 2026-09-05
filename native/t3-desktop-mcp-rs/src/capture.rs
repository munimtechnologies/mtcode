//! Screen and window capture, shared by every non-macOS backend.
//!
//! `xcap` already abstracts Windows' DXGI/GDI path and Linux's X11 path, so the
//! only platform-aware part left is which window belongs to which pid.
//!
//! On Linux hybrid sessions (Wayland + X11), we never mutate `WAYLAND_DISPLAY`:
//! that is UB with concurrent threads. Window enumeration already goes through
//! X11/`xcb` when `DISPLAY` is set. Display capture uses `xcap` only; list and
//! capture stay consistent (no grim-only displays advertised without capture).

use image::{ImageEncoder, RgbaImage, codecs::jpeg::JpegEncoder, codecs::png::PngEncoder, imageops::FilterType};
use xcap::{Monitor, Window};

use crate::platform::{DesktopError, Result};

/// Run a capture call that may panic inside `xcap`.
///
/// `xcap` panics rather than erroring on unsupported compositors and protocol
/// versions. Those are ordinary conditions for us — a headless box, an old
/// Wayland — so they become tool errors instead of killing the process.
fn guarded<T>(what: &str, call: impl FnOnce() -> Result<T>) -> Result<T> {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(call)) {
        Ok(result) => result,
        Err(_) => Err(DesktopError::new(format!(
            "{what} is not supported by this display server — the Wayland screenshot protocols \
             vary by compositor. Use get_app_state to read the UI instead; it does not need a \
             screen capture"
        ))),
    }
}

/// Matches the macOS server's default, which keeps a full-screen capture around
/// 200-400 KB of base64 — large enough to read UI text, small enough to not
/// dominate a model's context window.
pub const DEFAULT_MAX_WIDTH: u32 = 1400;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum CaptureFormat {
    Png,
    Jpeg,
}

impl CaptureFormat {
    pub fn parse(value: Option<&str>) -> Result<Self> {
        match value.unwrap_or("png").to_ascii_lowercase().as_str() {
            "png" => Ok(Self::Png),
            "jpeg" | "jpg" => Ok(Self::Jpeg),
            other => Err(DesktopError::new(format!(
                "unsupported screenshot format '{other}' — use png or jpeg"
            ))),
        }
    }

    pub fn mime_type(self) -> &'static str {
        match self {
            Self::Png => "image/png",
            Self::Jpeg => "image/jpeg",
        }
    }
}

fn encode_image(image: RgbaImage, max_width: u32, format: CaptureFormat) -> Result<Vec<u8>> {
    let image = if max_width > 0 && image.width() > max_width {
        let height = ((image.height() as f64) * (max_width as f64) / (image.width() as f64))
            .round()
            .max(1.0) as u32;
        image::imageops::resize(&image, max_width, height, FilterType::Triangle)
    } else {
        image
    };

    let mut buffer = Vec::new();
    match format {
        CaptureFormat::Png => {
            PngEncoder::new(&mut buffer)
                .write_image(
                    image.as_raw(),
                    image.width(),
                    image.height(),
                    image::ExtendedColorType::Rgba8,
                )
                .map_err(|error| DesktopError::new(format!("failed to encode PNG: {error}")))?;
        }
        CaptureFormat::Jpeg => {
            // JPEG has no alpha; flatten onto black so translucent chrome does not
            // become opaque white noise.
            let rgb = image::DynamicImage::ImageRgba8(image).to_rgb8();
            JpegEncoder::new_with_quality(&mut buffer, 55)
                .write_image(
                    rgb.as_raw(),
                    rgb.width(),
                    rgb.height(),
                    image::ExtendedColorType::Rgb8,
                )
                .map_err(|error| DesktopError::new(format!("failed to encode JPEG: {error}")))?;
        }
    }
    Ok(buffer)
}

/// Whether the session is Wayland, matching how `xcap` decides.
pub(crate) fn on_wayland() -> bool {
    cfg!(target_os = "linux")
        && (std::env::var("XDG_SESSION_TYPE").is_ok_and(|value| value == "wayland")
            || std::env::var("WAYLAND_DISPLAY").is_ok_and(|value| !value.is_empty()))
}

pub fn list_displays() -> Result<String> {
    guarded("display enumeration", list_displays_inner)
}

fn list_displays_inner() -> Result<String> {
    let monitors = Monitor::all()
        .map_err(|error| DesktopError::new(format!("failed to enumerate displays: {error}")))?;
    if monitors.is_empty() {
        return Ok("no displays detected".to_string());
    }

    let mut lines = Vec::new();
    for (index, monitor) in monitors.iter().enumerate() {
        let name = monitor.name().unwrap_or_else(|_| format!("display {index}"));
        let width = monitor.width().unwrap_or(0);
        let height = monitor.height().unwrap_or(0);
        let x = monitor.x().unwrap_or(0);
        let y = monitor.y().unwrap_or(0);
        let primary = monitor.is_primary().unwrap_or(false);
        lines.push(format!(
            "[{index}] {name}  {width}x{height}  at ({x},{y}){}",
            if primary { "  PRIMARY" } else { "" }
        ));
    }
    Ok(lines.join("\n"))
}

/// Where a capture sits on screen, so the tool text can tell the model how an
/// image pixel maps back to the coordinates click/hover/zoom take.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct CaptureFrame {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub struct Capture {
    pub bytes: Vec<u8>,
    pub frame: CaptureFrame,
    pub pixel_width: u32,
    pub pixel_height: u32,
}

/// The mapping line every screenshot/zoom result carries. Screen coordinates on
/// Windows and X11 are the physical pixels `xcap` captures, so a full-size
/// capture maps 1:1 and only downscaling changes the ratio.
pub fn mapping_text(capture: &Capture, label: &str) -> String {
    let sx = f64::from(capture.pixel_width) / capture.frame.width.max(1.0);
    let sy = f64::from(capture.pixel_height) / capture.frame.height.max(1.0);
    let ox = capture.frame.x.round();
    let oy = capture.frame.y.round();
    format!(
        "{label}: screen origin ({ox:.0}, {oy:.0}), size {:.0}×{:.0}; image {}×{} px ({sx:.3} px per screen unit). \
         To act on something seen at image pixel (px, py): x = {ox:.0} + px / {sx:.3}, y = {oy:.0} + py / {sy:.3}. \
         Prefer element ids from get_app_state when the target is listed there; use zoom on a region to read small text.",
        capture.frame.width, capture.frame.height, capture.pixel_width, capture.pixel_height
    )
}

fn finish(image: RgbaImage, frame: CaptureFrame, max_width: u32, format: CaptureFormat) -> Result<Capture> {
    let image = if max_width > 0 && image.width() > max_width {
        let height = ((image.height() as f64) * (max_width as f64) / (image.width() as f64))
            .round()
            .max(1.0) as u32;
        image::imageops::resize(&image, max_width, height, FilterType::Triangle)
    } else {
        image
    };
    let (pixel_width, pixel_height) = (image.width(), image.height());
    Ok(Capture { bytes: encode_image(image, 0, format)?, frame, pixel_width, pixel_height })
}

pub fn capture_display(index: usize, max_width: u32, format: CaptureFormat) -> Result<Capture> {
    guarded("display capture", || capture_display_inner(index, max_width, format))
}

fn capture_display_inner(index: usize, max_width: u32, format: CaptureFormat) -> Result<Capture> {
    let monitors = Monitor::all()
        .map_err(|error| DesktopError::new(format!("failed to enumerate displays: {error}")))?;
    let monitor = monitors.get(index).ok_or_else(|| {
        DesktopError::new(format!(
            "display {index} does not exist — call list_displays ({} attached)",
            monitors.len()
        ))
    })?;
    let frame = CaptureFrame {
        x: f64::from(monitor.x().unwrap_or(0)),
        y: f64::from(monitor.y().unwrap_or(0)),
        width: f64::from(monitor.width().unwrap_or(0)),
        height: f64::from(monitor.height().unwrap_or(0)),
    };
    let image = monitor
        .capture_image()
        .map_err(|error| DesktopError::new(format!("failed to capture display: {error}")))?;
    finish(image, frame, max_width, format)
}

/// Capture one region of the screen at full resolution. The region is given in
/// screen coordinates; it is clipped to the display that contains its centre.
pub fn capture_region(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    max_width: u32,
    format: CaptureFormat,
) -> Result<Capture> {
    guarded("region capture", || capture_region_inner(x0, y0, x1, y1, max_width, format))
}

fn capture_region_inner(
    x0: f64,
    y0: f64,
    x1: f64,
    y1: f64,
    max_width: u32,
    format: CaptureFormat,
) -> Result<Capture> {
    let (left, right) = (x0.min(x1), x0.max(x1));
    let (top, bottom) = (y0.min(y1), y0.max(y1));
    if right - left < 4.0 || bottom - top < 4.0 {
        return Err(DesktopError::new("zoom region must be at least 4×4"));
    }
    let monitors = Monitor::all()
        .map_err(|error| DesktopError::new(format!("failed to enumerate displays: {error}")))?;
    let (cx, cy) = ((left + right) / 2.0, (top + bottom) / 2.0);
    let monitor = monitors
        .iter()
        .find(|monitor| {
            let mx = f64::from(monitor.x().unwrap_or(0));
            let my = f64::from(monitor.y().unwrap_or(0));
            let mw = f64::from(monitor.width().unwrap_or(0));
            let mh = f64::from(monitor.height().unwrap_or(0));
            cx >= mx && cx < mx + mw && cy >= my && cy < my + mh
        })
        .or_else(|| monitors.first())
        .ok_or_else(|| DesktopError::new("no display contains that region — call list_displays"))?;
    let mx = f64::from(monitor.x().unwrap_or(0));
    let my = f64::from(monitor.y().unwrap_or(0));
    let image = monitor
        .capture_image()
        .map_err(|error| DesktopError::new(format!("failed to capture display: {error}")))?;
    // The capture is in physical pixels; screen coordinates may be logical on a
    // scaled display, so derive the ratio from the image itself.
    let ratio_x = f64::from(image.width()) / f64::from(monitor.width().unwrap_or(image.width())).max(1.0);
    let ratio_y = f64::from(image.height()) / f64::from(monitor.height().unwrap_or(image.height())).max(1.0);
    let px0 = (((left - mx) * ratio_x).floor().max(0.0) as u32).min(image.width().saturating_sub(1));
    let py0 = (((top - my) * ratio_y).floor().max(0.0) as u32).min(image.height().saturating_sub(1));
    let px1 = (((right - mx) * ratio_x).ceil().max(0.0) as u32).min(image.width());
    let py1 = (((bottom - my) * ratio_y).ceil().max(0.0) as u32).min(image.height());
    if px1 <= px0 + 1 || py1 <= py0 + 1 {
        return Err(DesktopError::new("zoom region lies outside the display"));
    }
    let cropped = image::imageops::crop_imm(&image, px0, py0, px1 - px0, py1 - py0).to_image();
    let frame = CaptureFrame {
        x: mx + f64::from(px0) / ratio_x,
        y: my + f64::from(py0) / ratio_y,
        width: f64::from(px1 - px0) / ratio_x,
        height: f64::from(py1 - py0) / ratio_y,
    };
    finish(cropped, frame, max_width, format)
}

/// Capture the largest window owned by `pid`.
///
/// Largest rather than frontmost: a foreground app often also owns tooltips and
/// tiny helper windows, and the biggest one is reliably the document window the
/// model means. Returns the window title alongside the PNG so the tool text can
/// name what it captured.
pub fn capture_app_window(pid: u32, max_width: u32, format: CaptureFormat) -> Result<(Capture, String)> {
    guarded("window capture", || capture_app_window_inner(pid, max_width, format))
}

fn capture_app_window_inner(pid: u32, max_width: u32, format: CaptureFormat) -> Result<(Capture, String)> {
    let windows = Window::all()
        .map_err(|error| DesktopError::new(format!("failed to enumerate windows: {error}")))?;

    let mut best: Option<(u32, &Window)> = None;
    for window in &windows {
        if window.pid().unwrap_or(0) != pid || window.is_minimized().unwrap_or(false) {
            continue;
        }
        let area = window.width().unwrap_or(0).saturating_mul(window.height().unwrap_or(0));
        if area == 0 {
            continue;
        }
        if best.as_ref().is_none_or(|(best_area, _)| area > *best_area) {
            best = Some((area, window));
        }
    }

    let (_, window) = best.ok_or_else(|| {
        DesktopError::new(format!(
            "pid {pid} has no capturable window — it may be minimized or have no UI"
        ))
    })?;
    let title = window.title().unwrap_or_default();
    let frame = CaptureFrame {
        x: f64::from(window.x().unwrap_or(0)),
        y: f64::from(window.y().unwrap_or(0)),
        width: f64::from(window.width().unwrap_or(0)),
        height: f64::from(window.height().unwrap_or(0)),
    };
    let image = window
        .capture_image()
        .map_err(|error| DesktopError::new(format!("failed to capture window: {error}")))?;
    Ok((finish(image, frame, max_width, format)?, title))
}

#[cfg(test)]
mod tests {
    use super::{DEFAULT_MAX_WIDTH, CaptureFormat, encode_image};
    use image::RgbaImage;

    #[test]
    fn encodes_a_png_signature() {
        let png = encode_image(RgbaImage::new(4, 4), DEFAULT_MAX_WIDTH, CaptureFormat::Png)
            .expect("encodes");
        assert_eq!(&png[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn encodes_a_jpeg_signature() {
        let jpeg = encode_image(RgbaImage::new(8, 8), DEFAULT_MAX_WIDTH, CaptureFormat::Jpeg)
            .expect("encodes");
        assert_eq!(&jpeg[..2], b"\xff\xd8");
    }

    #[test]
    fn downscales_only_when_wider_than_the_limit() {
        // Narrower than the cap: dimensions must survive untouched, since
        // upscaling would waste tokens without adding detail.
        let small = encode_image(RgbaImage::new(100, 50), 400, CaptureFormat::Png).expect("encodes");
        let decoded = image::load_from_memory(&small).expect("decodes");
        assert_eq!((decoded.width(), decoded.height()), (100, 50));

        // Wider than the cap: scaled down, aspect ratio preserved.
        let large = encode_image(RgbaImage::new(1000, 500), 400, CaptureFormat::Png).expect("encodes");
        let decoded = image::load_from_memory(&large).expect("decodes");
        assert_eq!((decoded.width(), decoded.height()), (400, 200));
    }

    #[test]
    fn mapping_text_states_origin_and_scale() {
        let capture = super::Capture {
            bytes: Vec::new(),
            frame: super::CaptureFrame { x: 100.0, y: 50.0, width: 800.0, height: 600.0 },
            pixel_width: 400,
            pixel_height: 300,
        };
        let text = super::mapping_text(&capture, "window");
        assert!(text.contains("screen origin (100, 50)"), "{text}");
        assert!(text.contains("0.500 px per screen unit"), "{text}");
        assert!(text.contains("x = 100 + px / 0.500"), "{text}");
    }

    #[test]
    fn a_zero_max_width_disables_downscaling() {
        let png = encode_image(RgbaImage::new(80, 20), 0, CaptureFormat::Png).expect("encodes");
        let decoded = image::load_from_memory(&png).expect("decodes");
        assert_eq!((decoded.width(), decoded.height()), (80, 20));
    }
}
