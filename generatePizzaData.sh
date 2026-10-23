#!/bin/bash
# Populates a JWT Pizza Service with starter users, menu, franchise, and store.
# Usage: ./generatePizzaData.sh <host>   e.g. ./generatePizzaData.sh http://localhost:3000

host=$1
if [ -z "$host" ]; then
  echo "Usage: $0 <host>"
  exit 1
fi

# Log in as the default admin and keep the token for the admin-only calls.
response=$(curl -s -X PUT $host/api/auth -d '{"email":"a@jwt.com", "password":"admin"}' -H 'Content-Type: application/json')
token=$(echo $response | jq -r '.token')
if [ -z "$token" ] || [ "$token" = "null" ]; then
  echo "admin login failed: $response"
  exit 1
fi
echo "admin login: ok"

# Users
for user in '{"name":"pizza diner", "email":"d@jwt.com", "password":"diner"}' '{"name":"pizza franchisee", "email":"f@jwt.com", "password":"franchisee"}'; do
  curl -s -X POST $host/api/auth -d "$user" -H 'Content-Type: application/json' | jq -r '"user: \(.user.email // .message)"'
done

# Menu
menu=(
  '{ "title":"Veggie", "description": "A garden of delight", "image":"pizza1.png", "price": 0.0038 }'
  '{ "title":"Pepperoni", "description": "Spicy treat", "image":"pizza2.png", "price": 0.0042 }'
  '{ "title":"Margarita", "description": "Essential classic", "image":"pizza3.png", "price": 0.0042 }'
  '{ "title":"Crusty", "description": "A dry mouthed favorite", "image":"pizza4.png", "price": 0.0028 }'
  '{ "title":"Charred Leopard", "description": "For those with a darker side", "image":"pizza5.png", "price": 0.0099 }'
)
for item in "${menu[@]}"; do
  curl -s -X PUT $host/api/order/menu -H 'Content-Type: application/json' -d "$item" -H "Authorization: Bearer $token" > /dev/null
  echo "menu: $(echo $item | jq -r '.title')"
done

# Franchise and store. Use the id the service returns rather than assuming 1.
franchise=$(curl -s -X POST $host/api/franchise -H 'Content-Type: application/json' -d '{"name": "pizzaPocket", "admins": [{"email": "f@jwt.com"}]}' -H "Authorization: Bearer $token")
franchiseId=$(echo $franchise | jq -r '.id')
echo "franchise: $(echo $franchise | jq -r '.name // .message') (id $franchiseId)"

curl -s -X POST $host/api/franchise/$franchiseId/store -H 'Content-Type: application/json' -d "{\"franchiseId\": $franchiseId, \"name\":\"SLC\"}" -H "Authorization: Bearer $token" | jq -r '"store: \(.name // .message)"'
