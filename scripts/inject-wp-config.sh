#!/bin/bash
CONFIG="/var/www/html/wp-config.php"
MARKER="That's all, stop editing"

if grep -q "HEADLESS_API_TOKEN" "$CONFIG"; then
  echo "Constants already present."
  grep "HEADLESS_API_TOKEN" "$CONFIG"
  exit 0
fi

python3 -c "
import re, sys
content = open('$CONFIG').read()
inject = \"define( 'HEADLESS_API_TOKEN', 'local-dev-token' );\ndefine( 'NEXT_REVALIDATE_URL', 'http://localhost:3004/api/revalidate' );\ndefine( 'REVALIDATION_SECRET', 'local-revalidate-secret' );\n\"
marker = \"/* That's all, stop editing!\"
content = content.replace(marker, inject + marker)
open('$CONFIG', 'w').write(content)
print('Done')
"

grep "HEADLESS_API_TOKEN" "$CONFIG"
