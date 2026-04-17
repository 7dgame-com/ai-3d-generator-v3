#!/bin/sh
set -e

# ============================================================
# docker-entrypoint.sh
# 动态生成 Nginx 负载均衡 + failover 配置
#
# 环境变量格式：
#   APP_API_1_URL=http://api:80
#   APP_API_1_WEIGHT=60                        （可选，默认平均分配）
#   APP_API_2_URL=https://api-backup.example.com
#   APP_API_2_WEIGHT=40
#   APP_CONFIG_1_URL=http://system-admin-backend:8088
#   APP_CONFIG_1_WEIGHT=100                    （可选）
#   APP_BACKEND_1_URL=http://plugin-backend:8089
#   APP_BACKEND_1_WEIGHT=100                   （可选）
#   APP_RESOLVER=127.0.0.11 8.8.8.8           （可选，DNS 解析服务器）
#
# 生成负载均衡 + failover：
#   split_clients 按权重分流 → map 映射后端 URL/Host
#   /api/        → 加权分流到 APP_API_N → failover 到环形下一个
#   /api-config/ → 加权分流到 APP_CONFIG_N → failover 到环形下一个
#   /backend/    → 加权分流到 APP_BACKEND_N → failover 到环形下一个
# ============================================================

TEMPLATE="/etc/nginx/templates/default.conf.template"
OUTPUT="/etc/nginx/conf.d/default.conf"

# 全局累积变量（http 层级配置：split_clients + map）
LB_HTTP_BLOCK=""

generate_lb_config() {
  ENV_PREFIX="$1"
  LOC_PATH="$2"
  PREFIX_NAME="$3"

  CHAIN_RESULT=""

  # --- 1. 收集后端信息 ---
  TOTAL=0
  i=1
  while true; do
    eval "url=\${${ENV_PREFIX}_${i}_URL}"
    if [ -z "$url" ]; then
      break
    fi

    eval "host=\${${ENV_PREFIX}_${i}_HOST}"
    eval "weight=\${${ENV_PREFIX}_${i}_WEIGHT}"

    if [ -z "$host" ]; then
      host=$(echo "$url" | sed -E 's|https?://||' | sed 's|/.*||' | sed 's|:.*||')
    fi

    TOTAL=$((TOTAL + 1))
    eval "LB_URL_${TOTAL}=\"${url}\""
    eval "LB_HOST_${TOTAL}=\"${host}\""
    eval "LB_WEIGHT_${TOTAL}=\"${weight}\""
    i=$((i + 1))
  done

  if [ "$TOTAL" -eq 0 ]; then
    echo "[entrypoint] WARNING: No ${ENV_PREFIX}_N_URL configured, skipping ${LOC_PATH}"
    return
  fi

  echo "[entrypoint] ---- ${LOC_PATH} load balancing ----"
  echo "[entrypoint] Found $TOTAL backend(s)"

  i=1
  while [ "$i" -le "$TOTAL" ]; do
    eval "u=\$LB_URL_${i}"
    eval "h=\$LB_HOST_${i}"
    eval "w=\$LB_WEIGHT_${i}"
    echo "[entrypoint]   Backend $i: $u (Host: $h, Weight: ${w:-auto})"
    i=$((i + 1))
  done

  if [ "$TOTAL" -eq 1 ]; then
    eval "url=\$LB_URL_1"
    eval "host=\$LB_HOST_1"

    echo "[entrypoint] Mode: single backend (direct upstream)"

    CHAIN_RESULT="
    # ============ 反向代理 - ${LOC_PATH} (单后端直连) ============
    location ${LOC_PATH} {
        rewrite ^${LOC_PATH}(.*)\$ /\$1 break;
        proxy_pass ${url};

        proxy_ssl_server_name on;
        proxy_set_header Host ${host};
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }"
    return
  fi

  echo "[entrypoint] Mode: load balancing ($TOTAL backends)"

  # --- 2. 计算权重 ---
  TOTAL_WEIGHT=0
  HAS_WEIGHT=0
  i=1
  while [ "$i" -le "$TOTAL" ]; do
    eval "w=\$LB_WEIGHT_${i}"
    if [ -n "$w" ]; then
      HAS_WEIGHT=1
      TOTAL_WEIGHT=$((TOTAL_WEIGHT + w))
    fi
    i=$((i + 1))
  done

  if [ "$HAS_WEIGHT" -eq 0 ]; then
    i=1
    while [ "$i" -le "$TOTAL" ]; do
      eval "LB_WEIGHT_${i}=1"
      i=$((i + 1))
    done
    TOTAL_WEIGHT=$TOTAL
  else
    i=1
    while [ "$i" -le "$TOTAL" ]; do
      eval "w=\$LB_WEIGHT_${i}"
      if [ -z "$w" ]; then
        eval "LB_WEIGHT_${i}=1"
        TOTAL_WEIGHT=$((TOTAL_WEIGHT + 1))
      fi
      i=$((i + 1))
    done
  fi

  # --- 3. 生成 split_clients（加权分流）---
  SC="
# ---- ${LOC_PATH} 加权分流 ----
split_clients \"\$request_id\" \$${PREFIX_NAME}_pool {"
  i=1
  while [ "$i" -le "$TOTAL" ]; do
    eval "w=\$LB_WEIGHT_${i}"
    if [ "$i" -eq "$TOTAL" ]; then
      SC="${SC}
    * ${i};"
    else
      pct=$(awk "BEGIN{printf \"%.1f\", ${w}/${TOTAL_WEIGHT}*100}")
      SC="${SC}
    ${pct}% ${i};"
    fi
    i=$((i + 1))
  done
  SC="${SC}
}"

  # --- 4. 生成 map（URL 和 Host 映射）---
  MAP_URL="
# ---- ${LOC_PATH} 后端 URL 映射 ----
map \$${PREFIX_NAME}_pool \$${PREFIX_NAME}_backend_url {"
  MAP_HOST="
# ---- ${LOC_PATH} 后端 Host 映射 ----
map \$${PREFIX_NAME}_pool \$${PREFIX_NAME}_backend_host {"

  i=1
  while [ "$i" -le "$TOTAL" ]; do
    eval "u=\$LB_URL_${i}"
    eval "h=\$LB_HOST_${i}"
    MAP_URL="${MAP_URL}
    ${i} \"${u}\";"
    MAP_HOST="${MAP_HOST}
    ${i} \"${h}\";"
    i=$((i + 1))
  done
  MAP_URL="${MAP_URL}
}"
  MAP_HOST="${MAP_HOST}
}"

  # --- 5. 生成 failover map（环形：N → (N%TOTAL)+1）---
  FB_MAP_URL="
# ---- ${LOC_PATH} Failover URL 映射（环形）----
map \$${PREFIX_NAME}_pool \$${PREFIX_NAME}_fb_url {"
  FB_MAP_HOST="
# ---- ${LOC_PATH} Failover Host 映射（环形）----
map \$${PREFIX_NAME}_pool \$${PREFIX_NAME}_fb_host {"

  i=1
  while [ "$i" -le "$TOTAL" ]; do
    fb_idx=$(( (i % TOTAL) + 1 ))
    eval "fu=\$LB_URL_${fb_idx}"
    eval "fh=\$LB_HOST_${fb_idx}"
    FB_MAP_URL="${FB_MAP_URL}
    ${i} \"${fu}\";"
    FB_MAP_HOST="${FB_MAP_HOST}
    ${i} \"${fh}\";"
    i=$((i + 1))
  done
  FB_MAP_URL="${FB_MAP_URL}
}"
  FB_MAP_HOST="${FB_MAP_HOST}
}"

  LB_HTTP_BLOCK="${LB_HTTP_BLOCK}${SC}${MAP_URL}${MAP_HOST}${FB_MAP_URL}${FB_MAP_HOST}"

  echo "[entrypoint] Traffic split (total weight: $TOTAL_WEIGHT):"
  i=1
  while [ "$i" -le "$TOTAL" ]; do
    eval "w=\$LB_WEIGHT_${i}"
    eval "u=\$LB_URL_${i}"
    pct=$(awk "BEGIN{printf \"%.1f\", ${w}/${TOTAL_WEIGHT}*100}")
    fb_idx=$(( (i % TOTAL) + 1 ))
    eval "fu=\$LB_URL_${fb_idx}"
    echo "[entrypoint]   Pool $i -> $u (${pct}%), failover -> $fu"
    i=$((i + 1))
  done

  # --- 6. 生成 location 块（server 层级）---
  CHAIN_RESULT="
    # ============ 反向代理 - ${LOC_PATH} (负载均衡 + Failover) ============
    location ${LOC_PATH} {
        rewrite ^${LOC_PATH}(.*)\$ /\$1 break;
        proxy_pass \$${PREFIX_NAME}_backend_url;

        proxy_ssl_server_name on;
        proxy_set_header Host \$${PREFIX_NAME}_backend_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;

        proxy_intercept_errors on;
        error_page 502 503 504 = @${PREFIX_NAME}_failover;
    }

    # ============ 反向代理 - ${LOC_PATH} Failover ============
    location @${PREFIX_NAME}_failover {
        rewrite ^${LOC_PATH}(.*)\$ /\$1 break;
        proxy_pass \$${PREFIX_NAME}_fb_url;

        proxy_ssl_server_name on;
        proxy_set_header Host \$${PREFIX_NAME}_fb_host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;

        proxy_connect_timeout 5s;
        proxy_read_timeout 120s;
        proxy_send_timeout 120s;
    }"
}

generate_lb_config "APP_API" "/api/" "api"
API_LOCATIONS="$CHAIN_RESULT"

generate_lb_config "APP_CONFIG" "/api-config/" "config"
CONFIG_LOCATIONS="$CHAIN_RESULT"

generate_lb_config "APP_BACKEND" "/backend/" "backend"
BACKEND_LOCATIONS="$CHAIN_RESULT"

RESOLVER_SERVERS="${APP_RESOLVER:-127.0.0.11}"
RESOLVER_BLOCK="resolver ${RESOLVER_SERVERS} valid=300s ipv6=off;
resolver_timeout 10s;"
echo "[entrypoint] DNS resolver: ${RESOLVER_SERVERS} (valid=300s)"

cp "$TEMPLATE" "$OUTPUT"

inject_locations() {
  PLACEHOLDER="$1"
  CONTENT="$2"
  if [ -n "$CONTENT" ]; then
    LOC_FILE=$(mktemp)
    printf '%s' "$CONTENT" > "$LOC_FILE"
    awk -v file="$LOC_FILE" -v marker="$PLACEHOLDER" '
      $0 ~ marker {
        while ((getline line < file) > 0) print line
        close(file)
        next
      }
      { print }
    ' "$OUTPUT" > "${OUTPUT}.tmp"
    mv "${OUTPUT}.tmp" "$OUTPUT"
    rm -f "$LOC_FILE"
  fi
}

inject_locations "# __RESOLVER__" "$RESOLVER_BLOCK"
inject_locations "# __LB_HTTP_BLOCK__" "$LB_HTTP_BLOCK"
inject_locations "# __API_LOCATIONS__" "$API_LOCATIONS"
inject_locations "# __CONFIG_LOCATIONS__" "$CONFIG_LOCATIONS"
inject_locations "# __BACKEND_LOCATIONS__" "$BACKEND_LOCATIONS"

echo "[entrypoint] Nginx config generated at $OUTPUT"

API_LIST=""
i=1
while true; do
  eval "url=\${APP_API_${i}_URL}"
  [ -z "$url" ] && break
  [ -n "$API_LIST" ] && API_LIST="${API_LIST}, "
  API_LIST="${API_LIST}\"APP_API_${i}_URL\": \"${url}\""
  i=$((i + 1))
done

CONFIG_LIST=""
i=1
while true; do
  eval "url=\${APP_CONFIG_${i}_URL}"
  [ -z "$url" ] && break
  [ -n "$CONFIG_LIST" ] && CONFIG_LIST="${CONFIG_LIST}, "
  CONFIG_LIST="${CONFIG_LIST}\"APP_CONFIG_${i}_URL\": \"${url}\""
  i=$((i + 1))
done

BACKEND_LIST=""
i=1
while true; do
  eval "url=\${APP_BACKEND_${i}_URL}"
  [ -z "$url" ] && break
  [ -n "$BACKEND_LIST" ] && BACKEND_LIST="${BACKEND_LIST}, "
  BACKEND_LIST="${BACKEND_LIST}\"APP_BACKEND_${i}_URL\": \"${url}\""
  i=$((i + 1))
done
cat > /usr/share/nginx/html/debug-env.json <<EOF
{
  ${API_LIST}${API_LIST:+, }${CONFIG_LIST}${CONFIG_LIST:+, }${BACKEND_LIST},
  "buildTime": "$(TZ='Asia/Shanghai' date '+%Y-%m-%d %H:%M:%S')",
  "hostname": "$(hostname)"
}
EOF

exec nginx -g 'daemon off;'
