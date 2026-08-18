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

pub fn capture_display(index: usize, max_width: u32, format: CaptureFormat) -> Result<Vec<u8>> {
    guarded("display capture", || capture_display_inner(index, max_width, format))
}

fn capture_display_inner(index: usize, max_width: u32, format: CaptureFormat) -> Result<Vec<u8>> {
    let monitors = Monitor::all()
        .map_err(|error| DesktopError::new(format!("failed to enumerate displays: {error}")))?;
    let monitor = monitors.get(index).ok_or_else(|| {
        DesktopError::new(format!(
            "display {index} does not exist — call list_displays ({} attached)",
            monitors.len()
        ))
    })?;
    let image = monitor
        .capture_image()
        .map_err(|error| DesktopError::new(format!("failed to capture display: {error}")))?;
    encode_image(image, max_width, format)
}

/// Capture the largest window owned by `pid`.
///
/// Largest rather than frontmost: a foreground app often also owns tooltips and
/// tiny helper windows, and the biggest one is reliably the document window the
/// model means. Returns the window title alongside the PNG so the tool text can
/// name what it captured.
pub fn capture_app_window(pid: u32, max_width: u32, format: CaptureFormat) -> Result<(Vec<u8>, String)> {
    guarded("window capture", || capture_app_window_inner(pid, max_width, format))
}

fn capture_app_window_inner(pid: u32, max_width: u32, format: CaptureFormat) -> Result<(Vec<u8>, String)> {
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
    let image = window
        .capture_image()
        .map_err(|error| DesktopError::new(format!("failed to capture window: {error}")))?;
    Ok((encode_image(image, max_width, format)?, title))
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
    fn a_zero_max_width_disables_downscaling() {
        let png = encode_image(RgbaImage::new(80, 20), 0, CaptureFormat::Png).expect("encodes");
        let decoded = image::load_from_memory(&png).expect("decodes");
        assert_eq!((decoded.width(), decoded.height()), (80, 20));
    }
}
