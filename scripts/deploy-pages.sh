#!/usr/bin/env bash
# Збирає застосунок і публікує dist/ у гілку gh-pages (GitHub Pages: Deploy from a branch → gh-pages / root).
set -euo pipefail
cd "$(dirname "$0")/.."
npm test
npm run build
tmp=$(mktemp -d)
cp -r dist/. "$tmp"
touch "$tmp/.nojekyll"
cd "$tmp"
git init -q -b gh-pages
git add -A
git -c user.name="${GIT_AUTHOR_NAME:-Cruise deploy}" -c user.email="${GIT_AUTHOR_EMAIL:-deploy@localhost}" commit -q -m "Deploy Cruise to GitHub Pages"
git push -f "$(git -C "$OLDPWD" remote get-url origin)" gh-pages:gh-pages
echo "Опубліковано в gh-pages"
