//! Tests for the cmd! macro and its aliases (s!, sh!, cs!)

use command_stream::{cmd, sh, s, cs};

#[tokio::test]
async fn test_cmd_macro_simple() {
    let result = cmd!("echo hello").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello"));
}

#[tokio::test]
async fn test_cmd_macro_with_interpolation() {
    let name = "world";
    let result = cmd!("echo hello {}", name).await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello"));
    assert!(result.stdout.contains("world"));
}

#[tokio::test]
async fn test_cmd_macro_with_multiple_interpolations() {
    let greeting = "Hello";
    let name = "World";
    let result = cmd!("echo {} {}", greeting, name).await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("Hello"));
    assert!(result.stdout.contains("World"));
}

#[tokio::test]
async fn test_cmd_macro_with_special_chars() {
    // Test that special characters are properly quoted
    let filename = "test file with spaces.txt";
    let result = cmd!("echo {}", filename).await.unwrap();
    assert!(result.is_success());
    // The output should contain the filename (quoted in the command)
    assert!(result.stdout.contains("test file with spaces.txt"));
}

#[tokio::test]
async fn test_sh_macro_alias() {
    let result = sh!("echo hello from sh").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello from sh"));
}

#[tokio::test]
async fn test_s_macro_alias() {
    let result = s!("echo hello from s").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello from s"));
}

#[tokio::test]
async fn test_cs_macro_alias() {
    let result = cs!("echo hello from cs").await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello from cs"));
}

#[tokio::test]
async fn test_s_macro_with_interpolation() {
    let name = "world";
    let result = s!("echo hello {}", name).await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("hello"));
    assert!(result.stdout.contains("world"));
}

#[tokio::test]
async fn test_cmd_macro_with_numbers() {
    let count = 42;
    let result = cmd!("echo The answer is {}", count).await.unwrap();
    assert!(result.is_success());
    assert!(result.stdout.contains("42"));
}
