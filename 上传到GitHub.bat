@echo off
chcp 65001 >nul
echo ============================================
echo   智账 PWA - GitHub Pages 上传脚本
echo   用法：1. 先改下面 REPO_URL 为你的仓库地址
echo        2. 双击运行（需已安装 Git）
echo ============================================
echo.
set REPO_URL=https://github.com/你的用户名/jizhang-pwa.git
set BRANCH=main

cd /d "%~dp0"

echo [1/4] 初始化 Git 仓库...
if not exist .git (
  git init
) else (
  echo   已存在 .git，跳过初始化
)

echo [2/4] 添加远程仓库...
git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo [3/4] 添加并提交文件...
git add -A
git commit -m "智账 PWA 部署：%date% %time%"

echo [4/4] 推送到 GitHub...
git branch -M %BRANCH%
git push -u origin %BRANCH%

echo.
echo ============================================
echo   上传完成！
echo   请到 GitHub 仓库 Settings - Pages 启用部署
echo   （Source: Deploy from branch, Branch: %BRANCH%, /root）
echo   然后 iPhone Safari 打开: https://你的用户名.github.io/jizhang-pwa/
echo ============================================
pause
