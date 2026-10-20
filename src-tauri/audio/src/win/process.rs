//! 从进程 ID 找到可执行文件，并读出给人看的程序名

use std::ffi::c_void;
use std::ptr::null_mut;

use windows::core::{w, HSTRING, PWSTR};
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows::Win32::System::Threading::{OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION};

pub fn image_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let result = QueryFullProcessImageNameW(handle, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(handle);
        result.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// 版本信息里的 FileDescription，如 chrome.exe → "Google Chrome"
pub fn file_description(path: &str) -> Option<String> {
    let path = HSTRING::from(path);
    unsafe {
        let size = GetFileVersionInfoSizeW(&path, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(&path, None, size, data.as_mut_ptr() as *mut c_void).ok()?;
        let block = data.as_ptr() as *const c_void;

        let mut ptr: *mut c_void = null_mut();
        let mut len = 0u32;
        let mut keys = Vec::new();
        if VerQueryValueW(block, w!("\\VarFileInfo\\Translation"), &mut ptr, &mut len).as_bool() && len >= 4 {
            let lang = *(ptr as *const u16);
            let codepage = *(ptr as *const u16).add(1);
            keys.push(format!("\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription"));
        }
        // 有些程序的翻译表不完整，再试两个最常见的
        keys.push("\\StringFileInfo\\040904b0\\FileDescription".into());
        keys.push("\\StringFileInfo\\080404b0\\FileDescription".into());

        for key in keys {
            let mut ptr: *mut c_void = null_mut();
            let mut len = 0u32;
            if VerQueryValueW(block, &HSTRING::from(key), &mut ptr, &mut len).as_bool() && len > 0 {
                let chars = std::slice::from_raw_parts(ptr as *const u16, len as usize);
                let text = String::from_utf16_lossy(chars).trim_end_matches('\0').trim().to_string();
                if !text.is_empty() {
                    return Some(text);
                }
            }
        }
        None
    }
}

