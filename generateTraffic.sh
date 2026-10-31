#!/bin/bash
# Simulates user traffic against a JWT Pizza Service so every Grafana metric has data.
# Requires the data from generatePizzaData.sh (diner d@jwt.com and a franchise with a store).
# Usage: ./generateTraffic.sh <host>   e.g. ./generateTraffic.sh http://localhost:3000
# Press Ctrl+C to stop.

host=$1
if [ -z "$host" ]; then
  echo "Usage: $0 <host>"
  exit 1
fi

# Look up a franchise, store, and menu item to order rather than assuming ids.
franchise=$(curl -s "$host/api/franchise?page=0&limit=10&name=*" | jq -c '[.franchises[] | select(.stores | length > 0)][0]')
franchiseId=$(echo $franchise | jq -r '.id')
storeId=$(echo $franchise | jq -r '.stores[0].id')
menuItem=$(curl -s $host/api/order/menu | jq -c '.[0] | {menuId: .id, description: .title, price: .price}')
if [ "$franchiseId" = "null" ] || [ -z "$menuItem" ] || [ "$menuItem" = "null" ]; then
  echo "No franchise with a store or no menu found. Run ./generatePizzaData.sh $host first."
  exit 1
fi
echo "ordering $(echo $menuItem | jq -r '.description') from franchise $franchiseId store $storeId"

# Stop every background loop when the script is interrupted.
trap 'echo; echo "stopping traffic"; kill 0' SIGINT SIGTERM EXIT

login() {
  curl -s -X PUT $host/api/auth -d '{"email":"d@jwt.com", "password":"diner"}' -H 'Content-Type: application/json' | jq -r '.token'
}

logout() {
  curl -s -o /dev/null -X DELETE $host/api/auth -H "Authorization: Bearer $1"
}

# Builds an order body with the given number of pizzas.
order() {
  jq -nc --argjson f $franchiseId --argjson s $storeId --argjson item "$menuItem" --argjson n $1 \
    '{franchiseId: $f, storeId: $s, items: [range($n) | $item]}'
}

# Menu browsing (GET requests).
while true; do
  curl -s -o /dev/null $host/api/order/menu
  echo "menu"
  sleep 3
done &

# Failed logins (PUT requests, failed auth attempts).
while true; do
  curl -s -o /dev/null -X PUT $host/api/auth -d '{"email":"unknown@jwt.com", "password":"bad"}' -H 'Content-Type: application/json'
  echo "invalid login"
  sleep 25
done &

# A user who logs in, stays active for a while, and logs out (successful auth, active users, DELETE requests).
while true; do
  token=$(login)
  echo "login active user"
  sleep 110
  logout $token
  echo "logout active user"
  sleep 10
done &

# A diner who orders a few pizzas (POST requests, pizzas sold, revenue, pizza latency).
while true; do
  token=$(login)
  echo "login diner"
  count=$((RANDOM % 3 + 1))
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST $host/api/order -H 'Content-Type: application/json' -d "$(order $count)" -H "Authorization: Bearer $token")
  echo "bought $count pizza(s): $status"
  sleep 20
  logout $token
  echo "logout diner"
  sleep 30
done &

# A diner who orders too many pizzas so the factory fails (creation failures, slow pizza latency).
while true; do
  token=$(login)
  status=$(curl -s -o /dev/null -w "%{http_code}" -X POST $host/api/order -H 'Content-Type: application/json' -d "$(order 21)" -H "Authorization: Bearer $token")
  echo "bought 21 pizzas: $status"
  sleep 5
  logout $token
  sleep 115
done &

wait
