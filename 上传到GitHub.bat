@echo off
chcp 65001 >nul
echo ============================================
echo   智账 PWA - GitHub Pages 上传脚本（冲突自动处理版）
echo   用法：1. 确认下面 REPO_URL 是你的仓库地址
echo        2. 双击运行（需已安装 Git，且已登录 GitHub）
echo ============================================
echo.
set REPO_URL=https://github.com/huatandi/jizhang-pwa.git
set BRANCH=main

cd /d "%~dp0"

echo [1/5] 检查/初始化 Git 仓库...
if not exist .git (
  git init
) else (
  echo   已存在 .git，跳过初始化
)

echo [2/5] 设置远程仓库...
git remote remove origin 2>nul
git remote add origin %REPO_URL%

echo [3/5] 添加并提交文件...
git add -A
git commit -m "智账 PWA 部署：%date% %time%" 2>nul
if errorlevel 1 (
  echo   没有新提交（可能文件未变化），继续推送
)

echo [4/5] 同步远程并推送（自动处理 index.html / js\app.js 等旧文件冲突）...
git branch -M %BRANCH%

rem 第一次推送：先拉取远程历史（允许无关历史），用本地文件覆盖旧版
git pull --rebase --allow-unrelated-histories -X theirs origin %BRANCH% 2>nul

rem 推送（若远程有旧版同名文件导致冲突，使用强制推送覆盖为最新版）
git push -u origin %BRANCH% 2>nul
if errorlevel 1 (
  echo   普通推送失败（远程可能有旧版本），改用强制推送覆盖...
  git push -f -u origin %BRANCH%
)

echo [5/5] 完成！
echo.
echo ============================================
echo   上传完成！
echo   1. 打开 https://github.com/huatandi/jizhang-pwa
echo      确认 index.html / js\app.js 等文件已是最新版
echo   2. 仓库 Settings - Pages 启用部署
echo      （Source: Deploy from branch, Branch: main, /root）
echo   3. iPhone Safari 打开: https://huatandi.github.io/jizhang-pwa/
echo   4. 若打不开或显示旧版：Settings-Pages 选一次
echo      main 分支重新部署，或等 1-2 分钟
echo ============================================
pause
