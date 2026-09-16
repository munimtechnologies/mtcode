//! Tool schemas, kept byte-compatible with the macOS Swift server's `toolDefs`.
//!
//! A model that learned the tools on one platform must not have to relearn them
//! on another, so the names, argument shapes and descriptions are deliberately
//! identical. Behavioural differences belong in the tool text, not the schema.

use serde_json::{Value, json};

/// Host settings pass `T3_DESKTOP_BROWSER=0` when browser control is off.
pub fn env_flag_disabled(name: &str) -> bool {
    match std::env::var(name) {
        Ok(raw) => {
            let trimmed = raw.trim().to_ascii_lowercase();
            matches!(trimmed.as_str(), "0" | "false" | "off" | "no")
        }
        Err(_) => false,
    }
}

pub fn browser_control_enabled() -> bool {
    !env_flag_disabled("T3_DESKTOP_BROWSER")
}

pub fn tool_defs() -> Value {
    let defs = all_tool_defs();
    if browser_control_enabled() {
        return defs;
    }
    let Some(array) = defs.as_array() else {
        return defs;
    };
    Value::Array(
        array
            .iter()
            .filter(|tool| {
                tool.get("name")
                    .and_then(Value::as_str)
                    .is_none_or(|name| !name.starts_with("browser_"))
            })
            .cloned()
            .collect(),
    )
}

fn all_tool_defs() -> Value {
    json!([
        {
            "name": "list_apps",
            "description": "List running applications with their bundle id, pid, window count, and which one is frontmost. Call it first to learn the exact `app` value that get_app_state, screenshot and activate_app accept. One app can have several running instances and only some own windows, so prefer the instance that has windows. Read-only: no window or input is touched.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            },
            "annotations": {
                "title": "List running apps",
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "get_app_state",
            "description": "Read an app's accessibility tree as an indented outline in which interactive elements carry ids like [e12] that click, type_text, set_value, scroll, hover and select_text accept. Use it instead of screenshot whenever you intend to act: it is far cheaper in tokens and gives exact targets. Call it before interacting and again after the UI changes, because ids are per-snapshot and a stale id fails. Read-only; it describes the app's visible windows and does not change focus.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "app": {
                        "type": "string",
                        "description": "App name, bundle id, or pid exactly as reported by list_apps"
                    },
                    "max_depth": {
                        "type": "integer",
                        "description": "Maximum nesting depth to descend (default 18). Lower it for a quick overview of a large window."
                    },
                    "max_elements": {
                        "type": "integer",
                        "description": "Maximum elements to emit before the outline is truncated (default 800). Prefer `query` over raising this."
                    },
                    "query": {
                        "type": "string",
                        "description": "Only list elements whose role, label or value contains this text (case-insensitive). Ids stay valid. Use it instead of raising max_elements when you know what you are looking for."
                    }
                },
                "required": ["app"]
            },
            "annotations": {
                "title": "Read accessibility tree",
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "click",
            "description": "Click an element by element_id (preferred: it uses the accessibility press action, so it works even when the element is scrolled out of view) or at absolute screen coordinates taken from a screenshot or zoom. Pass element_id or x and y, not both. Use browser_click for pages in the agent's Chrome tabs, right_click for context menus, and drag for press-move-release. The click reaches the target app for real and can trigger any action the user could, so read the target with get_app_state first. The agent pointer overlay moves to the target; the user's own mouse pointer does not.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "string",
                        "description": "Element id from the most recent get_app_state snapshot, e.g. e12. Preferred over coordinates."
                    },
                    "x": {
                        "type": "number",
                        "description": "Screen x coordinate in points, used together with y when no element_id is given"
                    },
                    "y": {
                        "type": "number",
                        "description": "Screen y coordinate in points, used together with x when no element_id is given"
                    },
                    "click_count": {
                        "type": "integer",
                        "description": "1 for a single click (default), 2 for a double-click"
                    }
                }
            },
            "annotations": {
                "title": "Click",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            }
        },
        {
            "name": "type_text",
            "description": "Type literal text as keystrokes into the field that currently has focus, optionally focusing element_id first. Use it for short entries and for fields that reject set_value; use set_value to replace a long value in one step, and press_key for shortcuts or keys such as return and tab. Text is inserted at the caret without clearing what is already there. Typing into password fields is refused by default (see COMPUTER_USE_ALLOW_SECURE_FIELD_INPUT).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "text": {
                        "type": "string",
                        "description": "Exact text to type, character by character"
                    },
                    "element_id": {
                        "type": "string",
                        "description": "Element to focus before typing, from get_app_state. Omit to type into whatever currently has focus."
                    }
                },
                "required": ["text"]
            },
            "annotations": {
                "title": "Type text",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            }
        },
        {
            "name": "press_key",
            "description": "Press one named key, optionally with modifiers held, e.g. key='s' modifiers=['cmd'] to save or key='return' to submit. Use it for shortcuts and navigation keys; use type_text for literal text and browser_press_key inside the agent's Chrome tabs. The key goes to the focused app, so call activate_app or click first when focus is uncertain. Shortcuts can close windows or delete content, so confirm the target before pressing.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "key": {
                        "type": "string",
                        "description": "Key name: a single character such as 's', or a named key such as return, tab, escape, space, delete, backspace, up, down, left, right, home, end, pageup, pagedown"
                    },
                    "modifiers": {
                        "type": "array",
                        "items": {
                            "type": "string"
                        },
                        "description": "Modifier keys to hold while pressing: any of cmd, shift, alt, ctrl, fn. cmd maps to the Windows/Super key off macOS."
                    }
                },
                "required": ["key"]
            },
            "annotations": {
                "title": "Press key",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            }
        },
        {
            "name": "scroll",
            "description": "Scroll the content under the pointer up, down, left or right by a number of lines, optionally moving the pointer over element_id first so the right pane scrolls. Use it to bring off-screen content into view before get_app_state or screenshot. It only scrolls; nothing is clicked or selected.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "direction": {
                        "type": "string",
                        "enum": ["up", "down", "left", "right"],
                        "description": "Scroll direction (default down)"
                    },
                    "amount": {
                        "type": "integer",
                        "description": "Number of scroll lines (default 5)"
                    },
                    "element_id": {
                        "type": "string",
                        "description": "Element to position the pointer over before scrolling, from get_app_state. Omit to scroll at the current pointer position."
                    }
                }
            },
            "annotations": {
                "title": "Scroll",
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": false,
                "openWorldHint": false
            }
        },
        {
            "name": "activate_app",
            "description": "Bring an app's windows to the foreground and give it keyboard focus. Call it before press_key or type_text when the target app is not frontmost; element-id actions such as click and set_value do not need it. Side effect: the window the user was working in loses focus.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "app": {
                        "type": "string",
                        "description": "App name, bundle id, or pid exactly as reported by list_apps"
                    }
                },
                "required": ["app"]
            },
            "annotations": {
                "title": "Activate app",
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "screenshot",
            "description": "Capture an app's largest window, or a whole display, as an image. The result text states the capture's screen origin and pixels-per-point so an image pixel can be converted into click or hover coordinates. Prefer get_app_state for interaction, which is cheaper and returns clickable element ids; use screenshot to verify an outcome or to see content the accessibility tree cannot describe (canvas, video, custom drawing), and zoom to read small text. Read-only; the captured window is not raised or focused.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "app": {
                        "type": "string",
                        "description": "App name, bundle id, or pid exactly as reported by list_apps. Captures that app's largest window. Provide either app or display."
                    },
                    "display": {
                        "type": "integer",
                        "description": "0-based display index from list_displays. Captures the whole display instead of an app window."
                    },
                    "max_width": {
                        "type": "integer",
                        "description": "Downscale the image to this width in pixels (default 1400). Lower it to save tokens."
                    },
                    "format": {
                        "type": "string",
                        "enum": ["png", "jpeg"],
                        "description": "Image encoding (default png). Use jpeg for live remote viewing."
                    }
                }
            },
            "annotations": {
                "title": "Screenshot",
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "list_displays",
            "description": "List every attached display with its index, resolution and position, for use with screenshot(display: N) and for interpreting screen coordinates on multi-monitor setups. Read-only.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            },
            "annotations": {
                "title": "List displays",
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "right_click",
            "description": "Right-click (secondary click) an element or screen position to open its context menu. Follow with get_app_state to read the menu items, then click one. Use click for normal activation. Pass element_id or x and y, not both.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "string",
                        "description": "Element id from the most recent get_app_state snapshot, e.g. e12"
                    },
                    "x": {
                        "type": "number",
                        "description": "Screen x coordinate in points, used together with y when no element_id is given"
                    },
                    "y": {
                        "type": "number",
                        "description": "Screen y coordinate in points, used together with x when no element_id is given"
                    }
                }
            },
            "annotations": {
                "title": "Right-click",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            }
        },
        {
            "name": "drag",
            "description": "Press at one point, move, and release at another to drag and drop, move a slider, or select a range. Give each end as an element id or as screen coordinates; the two ends may use different forms. A drop can move or reorder items in the app, so verify the result with get_app_state.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "from_element_id": {
                        "type": "string",
                        "description": "Element to start the drag on, from get_app_state"
                    },
                    "to_element_id": {
                        "type": "string",
                        "description": "Element to release on, from get_app_state"
                    },
                    "from_x": {
                        "type": "number",
                        "description": "Screen x to start at, used with from_y when no from_element_id is given"
                    },
                    "from_y": {
                        "type": "number",
                        "description": "Screen y to start at, used with from_x when no from_element_id is given"
                    },
                    "to_x": {
                        "type": "number",
                        "description": "Screen x to release at, used with to_y when no to_element_id is given"
                    },
                    "to_y": {
                        "type": "number",
                        "description": "Screen y to release at, used with to_x when no to_element_id is given"
                    }
                }
            },
            "annotations": {
                "title": "Drag",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            }
        },
        {
            "name": "set_value",
            "description": "Replace a text field's entire contents in one step through the accessibility API, without keystrokes. Prefer it over type_text for long values or when the field already holds text; fall back to click plus type_text if the field rejects it, which the result reports. The previous value is discarded.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "string",
                        "description": "Text field to set, from get_app_state"
                    },
                    "value": {
                        "type": "string",
                        "description": "New complete value for the field"
                    }
                },
                "required": ["element_id", "value"]
            },
            "annotations": {
                "title": "Set field value",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "zoom",
            "description": "Capture one region of the screen at full resolution, to read small text, dense tables, file names or tiny controls that a normal screenshot blurs. Give the region as two corners in screen coordinates (the same space click uses); the result text explains how to map pixels in the zoomed image back to screen coordinates. Use screenshot for a whole window and get_app_state when the text is exposed by accessibility. Read-only.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "x0": {
                        "type": "number",
                        "description": "Left edge, screen coordinates"
                    },
                    "y0": {
                        "type": "number",
                        "description": "Top edge, screen coordinates"
                    },
                    "x1": {
                        "type": "number",
                        "description": "Right edge, screen coordinates"
                    },
                    "y1": {
                        "type": "number",
                        "description": "Bottom edge, screen coordinates"
                    },
                    "max_width": {
                        "type": "integer",
                        "description": "Downscale the zoomed image to this width in pixels (default 1400)"
                    }
                },
                "required": ["x0", "y0", "x1", "y1"]
            },
            "annotations": {
                "title": "Zoom into region",
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "hover",
            "description": "Move the agent pointer over an element or screen position without clicking, to reveal hover menus, toolbars, tooltips or drag handles. Follow with get_app_state or screenshot to see what appeared. Use click to activate. Pass element_id or x and y, not both. The user's own mouse pointer is not moved.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "string",
                        "description": "Element id from the most recent get_app_state snapshot, e.g. e12"
                    },
                    "x": {
                        "type": "number",
                        "description": "Screen x coordinate in points, used together with y when no element_id is given"
                    },
                    "y": {
                        "type": "number",
                        "description": "Screen y coordinate in points, used together with x when no element_id is given"
                    }
                }
            },
            "annotations": {
                "title": "Hover",
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "wait",
            "description": "Pause before the next action so the UI can catch up: page loads, animations, dialogs opening, apps launching. Follow with get_app_state or screenshot to confirm the new state instead of guessing. Sends no input.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "seconds": {
                        "type": "number",
                        "description": "Seconds to wait (default 1, maximum 30)"
                    }
                }
            },
            "annotations": {
                "title": "Wait",
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "select_text",
            "description": "Select a character range inside a text element through the accessibility API, for example to copy part of a value or to replace just that part with type_text. Defaults to selecting from `start` to the end of the value. Use set_value to replace the whole value instead. Only the selection changes; the text is not modified.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "element_id": {
                        "type": "string",
                        "description": "Text element to select in, from get_app_state"
                    },
                    "start": {
                        "type": "integer",
                        "description": "Zero-based character offset to start the selection at (default 0)"
                    },
                    "length": {
                        "type": "integer",
                        "description": "Number of characters to select (default: through the end of the value)"
                    }
                },
                "required": ["element_id"]
            },
            "annotations": {
                "title": "Select text",
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "browser_open_tab",
            "description": "Open a URL in a new background tab inside the agent's own labelled tab group in the user's signed-in Chrome, and return its tab_id for browser_snapshot, browser_click, browser_type and browser_navigate. The tab opens in the background, so the user's browsing is not interrupted. Requires the Computer Use Chrome extension; a limited fallback mode applies without it.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "url": {
                        "type": "string",
                        "description": "Absolute URL to open (default about:blank)"
                    }
                }
            },
            "annotations": {
                "title": "Open browser tab",
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": false,
                "openWorldHint": true
            }
        },
        {
            "name": "browser_list_tabs",
            "description": "List the tabs in the agent's own Chrome tab group, marking the active one, with the tab_id each other browser tool needs. The user's own tabs are not listed; the agent only drives tabs it opened. Read-only.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            },
            "annotations": {
                "title": "List browser tabs",
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "browser_select_tab",
            "description": "Make one of the agent's tabs the visible one in its window, for example before capturing it with screenshot. browser_snapshot, browser_click and browser_type work on background tabs, so most tasks never need this. The agent's group lives in the user's Chrome window, so this changes which tab that window shows; use it sparingly. The user's own tabs are never selected.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab_id": {
                        "type": "integer",
                        "description": "tab_id of one of the agent's tabs, from browser_open_tab or browser_list_tabs"
                    },
                    "index": {
                        "type": "integer",
                        "description": "1-based position within the agent's tabs; fallback mode only, when tab_id is unavailable"
                    }
                }
            },
            "annotations": {
                "title": "Select browser tab",
                "readOnlyHint": false,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "browser_close_tab",
            "description": "Close one of the agent's tabs, discarding any unsaved page state. Use browser_close_all_tabs to clean up everything at the end of a task.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab_id": {
                        "type": "integer",
                        "description": "tab_id of one of the agent's tabs, from browser_open_tab or browser_list_tabs"
                    },
                    "index": {
                        "type": "integer",
                        "description": "1-based position within the agent's tabs; fallback mode only, when tab_id is unavailable"
                    }
                }
            },
            "annotations": {
                "title": "Close browser tab",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "browser_snapshot",
            "description": "List the interactive elements (links, buttons, inputs) on the page in one of the agent's tabs, with the index each one has for browser_click, plus the page title and URL. Works on a background tab, so the user can be looking at something else. Use it before every browser_click, because indices change when the page changes. Read-only.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab_id": {
                        "type": "integer",
                        "description": "tab_id of one of the agent's tabs, from browser_open_tab or browser_list_tabs"
                    }
                },
                "required": ["tab_id"]
            },
            "annotations": {
                "title": "Snapshot page elements",
                "readOnlyHint": true,
                "destructiveHint": false,
                "idempotentHint": true,
                "openWorldHint": true
            }
        },
        {
            "name": "browser_click",
            "description": "Click in one of the agent's tabs, either an element by its index from browser_snapshot (preferred) or a point given in page coordinates. Pass index or x and y, not both. Works on a background tab. Use click for native app windows. A click can submit forms or follow links, so snapshot first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab_id": {
                        "type": "integer",
                        "description": "tab_id of one of the agent's tabs, from browser_open_tab or browser_list_tabs"
                    },
                    "index": {
                        "type": "integer",
                        "description": "Element index from the latest browser_snapshot of this tab. Preferred over coordinates."
                    },
                    "x": {
                        "type": "number",
                        "description": "Page x coordinate in CSS pixels, used together with y when no index is given"
                    },
                    "y": {
                        "type": "number",
                        "description": "Page y coordinate in CSS pixels, used together with x when no index is given"
                    }
                },
                "required": ["tab_id"]
            },
            "annotations": {
                "title": "Click in browser",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": true
            }
        },
        {
            "name": "browser_type",
            "description": "Type text into the field that currently has focus in one of the agent's tabs; browser_click the field first. Text is inserted at the caret without clearing existing content. Use browser_press_key for Enter, Tab, Escape or Backspace, and type_text for native apps.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab_id": {
                        "type": "integer",
                        "description": "tab_id of one of the agent's tabs, from browser_open_tab or browser_list_tabs"
                    },
                    "text": {
                        "type": "string",
                        "description": "Exact text to type into the focused field"
                    }
                },
                "required": ["tab_id", "text"]
            },
            "annotations": {
                "title": "Type in browser",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            }
        },
        {
            "name": "browser_press_key",
            "description": "Press Enter, Tab, Escape or Backspace in one of the agent's tabs, for example Enter to submit a form after browser_type. Only these four keys are supported; use browser_type for characters. Enter can submit forms and Backspace deletes, so check the page state with browser_snapshot first.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab_id": {
                        "type": "integer",
                        "description": "tab_id of one of the agent's tabs, from browser_open_tab or browser_list_tabs"
                    },
                    "key": {
                        "type": "string",
                        "enum": ["Enter", "Tab", "Escape", "Backspace"],
                        "description": "Key to press"
                    }
                },
                "required": ["tab_id", "key"]
            },
            "annotations": {
                "title": "Press key in browser",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": false
            }
        },
        {
            "name": "browser_close_all_tabs",
            "description": "Close every tab the agent opened and remove its tab group. Call this when finished with the browser so no empty group is left in the user's tab strip. The MCP process also runs this automatically when the Computer Use session ends. Unsaved state in the agent's tabs is lost.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            },
            "annotations": {
                "title": "Close all agent tabs",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "browser_navigate",
            "description": "Point one of the agent's tabs at a different URL, replacing the current page; unsaved page state is lost. Use browser_open_tab to keep the current page and open another. Follow with browser_snapshot, since element indices reset after navigation.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "tab_id": {
                        "type": "integer",
                        "description": "tab_id of one of the agent's tabs, from browser_open_tab or browser_list_tabs"
                    },
                    "url": {
                        "type": "string",
                        "description": "Absolute URL to load in the tab"
                    }
                },
                "required": ["tab_id", "url"]
            },
            "annotations": {
                "title": "Navigate browser tab",
                "readOnlyHint": false,
                "destructiveHint": true,
                "idempotentHint": false,
                "openWorldHint": true
            }
        }
    ])
}

#[cfg(test)]
mod tests {
    use super::{all_tool_defs, tool_defs};

    /// The macOS server advertises exactly these 26 tools. Drifting apart would
    /// silently give a model different capabilities per platform.
    #[test]
    fn advertises_the_macos_tool_surface() {
        let defs = all_tool_defs();
        let names: Vec<&str> = defs
            .as_array()
            .expect("tool defs are an array")
            .iter()
            .map(|tool| tool["name"].as_str().expect("tool has a name"))
            .collect();

        assert_eq!(names.len(), 26, "tool count drifted from the macOS server");
        for expected in [
            "list_apps",
            "get_app_state",
            "click",
            "type_text",
            "press_key",
            "scroll",
            "activate_app",
            "screenshot",
            "list_displays",
            "right_click",
            "drag",
            "set_value",
            "zoom",
            "hover",
            "wait",
            "select_text",
            "browser_open_tab",
            "browser_list_tabs",
            "browser_select_tab",
            "browser_close_tab",
            "browser_snapshot",
            "browser_click",
            "browser_type",
            "browser_press_key",
            "browser_close_all_tabs",
            "browser_navigate",
        ] {
            assert!(names.contains(&expected), "missing tool {expected}");
        }
    }

    #[test]
    fn every_tool_declares_an_object_input_schema() {
        for tool in tool_defs().as_array().expect("tool defs are an array") {
            let schema = &tool["inputSchema"];
            assert_eq!(
                schema["type"].as_str(),
                Some("object"),
                "{} has a non-object input schema",
                tool["name"]
            );
            assert!(
                schema["properties"].is_object(),
                "{} is missing properties",
                tool["name"]
            );
        }
    }
}
