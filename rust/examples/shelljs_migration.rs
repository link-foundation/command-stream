use command_stream::shelljs::ShellJs;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let directory = tempfile::tempdir()?;
    std::fs::write(
        directory.path().join("log with spaces.txt"),
        "WARN disk\nINFO ready\nWARN disk\n",
    )?;
    let mut shell = ShellJs::new();
    shell.config.silent = true;
    shell
        .cd(&[directory.path().to_str().ok_or("non-UTF8 path")?])
        .await?;
    let result = shell.head(&["-n", "2", "log with spaces.txt"]).await?;
    println!("{}", result.stdout);
    let sorted = shell.sort(&["log with spaces.txt"]).await?;
    shell.to(&sorted, "sorted.txt", false).await?;
    println!("{}", shell.uniq(&["-c", "sorted.txt"]).await?.stdout);
    Ok(())
}
