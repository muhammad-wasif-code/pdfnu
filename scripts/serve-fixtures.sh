#!/bin/sh
# Dev only: expose test fixtures at /__test__/ in the local build output (never deployed: dist is rebuilt by CI).
mkdir -p dist/__test__ && cp test/fixtures/*.pdf test/fixtures/*.jpg test/fixtures/*.png test/fixtures/*.webp test/fixtures/*.heic dist/__test__/ 2>/dev/null; cp test/browser-helpers.js dist/__test__/; true
