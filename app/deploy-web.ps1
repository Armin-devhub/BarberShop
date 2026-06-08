# Deploy the staff/admin web app to the Vercel "novyx" project
# (https://novyx-three.vercel.app). Run from anywhere:  ./app/deploy-web.ps1
#
# Why a script: `expo export --clear` wipes the output dir every time (so the
# vercel.json rewrite, the .vercelignore that keeps the icon fonts, AND the
# .vercel project link all vanish). This re-applies them in the right order so
# we never (a) ship without the SPA rewrite, (b) lose the icons, or (c)
# accidentally create a stray project by deploying unlinked.
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot   # the app/ folder

Write-Host "1/3  Building web (clean, so EXPO_PUBLIC_* env re-inlines)..." -ForegroundColor Cyan
npx expo export -p web --clear --output-dir dist2

Write-Host "2/3  Applying deploy config..." -ForegroundColor Cyan
Copy-Item web-deploy/vercel.json     dist2/vercel.json    -Force
Copy-Item web-deploy/vercelignore    dist2/.vercelignore  -Force

Write-Host "3/3  Deploying to novyx..." -ForegroundColor Cyan
Set-Location dist2
npx vercel link --yes --project novyx | Out-Null
npx vercel --prod --yes

Write-Host "Done -> https://novyx-three.vercel.app" -ForegroundColor Green
