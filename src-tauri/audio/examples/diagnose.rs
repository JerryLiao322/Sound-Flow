//! 打印音频后端在这台电脑上的工作情况：`cargo run -p soundflow-audio --example diagnose`

fn main() {
    #[cfg(windows)]
    for line in soundflow_audio::diagnostics() {
        println!("{line}");
    }
    #[cfg(not(windows))]
    println!("诊断只能在 Windows 上运行");
}
