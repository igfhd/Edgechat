  假设源码已经上传至家目录下的 ~/Edgechat（如果是压缩包已解压至该目录）。

  ———

  ### 一、连接 VPS 与检查 Docker 环境

  通过 SSH 登录 VPS 后，首先检查是否已安装 Docker 和 Docker Compose 插件。

  # 检查 Docker 版本
  docker --version

  # 检查 Docker Compose 版本
  docker compose version

  如果未安装 Docker，可使用官方一键脚本进行安装：

  curl -fsSL https://get.docker.com | bash

  # 启动并设置 Docker 开机自启
  sudo systemctl enable --now docker

  ———

  ### 二、进入源码目录与调整配置

  进入项目的部署目录，根据 VPS 性能检查或调整参数。

  cd ~/Edgechat/deploy

  查看并确认 docker-compose.yml (deploy/docker-compose.yml)：

  cat docker-compose.yml

  默认配置内容如下：

  services:
    edgechat-deployer:
      build:
        context: ..
        dockerfile: deploy/Dockerfile
      image: edgechat-deployer:latest
      container_name: edgechat-deployer
      restart: unless-stopped
      ports:
        - "127.0.0.1:8000:8000"
      environment:
        PYTHONPATH: "/app/server"
        EDGECHAT_CONCURRENCY: "2"       # 默认最大并发构建任务数
        EDGECHAT_JOB_TTL: "86400"        # 任务留存 24 小时后自动销毁
        PORT: "8000"
        EDGECHAT_DATA_DIR: "/app/server/data"
        EDGECHAT_JOBS_DIR: "/tmp/edgechat_deploy_jobs"
      volumes:
        - ./data:/app/server/data
        - ./tmp:/tmp/edgechat_deploy_jobs

  > 提示：
  >
  > - 如果 VPS 上 8000 端口被其他服务占用，可将端口映射改为 "127.0.0.1:8001:8000"。
  > - 如果服务器内存较大（如 4G+），可将 EDGECHAT_CONCURRENCY 调高为 4。

  ———

  ### 三、构建并启动容器

  在 ~/Edgechat/deploy 目录下执行构建与后台启动命令：

  docker compose up -d --build

  启动后检查容器运行状态与启动日志：

  # 查看容器状态（确认状态为 Up）
  docker compose ps

  # 查看实时日志
  docker compose logs -f

  当看到日志输出包含 Uvicorn running on http://0.0.0.0:8000 时，说明后端服务已正常启动。

  ———

  ### 四、配置 Nginx 反向代理与 SSL 证书

  由于 Web Deployer 需要用户在浏览器中输入 Cloudflare API Token，强烈建议配置 Nginx 反代并强制启用 HTTPS (SSL) 以确保凭据传输安全。

  #### 1. 安装 Nginx 和 Certbot

  sudo apt update
  sudo apt install -y nginx certbot python3-certbot-nginx

  #### 2. 配置 Nginx 站点

  创建 Nginx 配置文件（以 deploy.yourdomain.com 为例）：

  sudo nano /etc/nginx/conf.d/edgechat-deployer.conf

  写入以下配置（注意替换其中的域名）：

  server {
      listen 80;
      server_name deploy.yourdomain.com;
      return 301 https://$host$request_uri;
  }

  server {
      listen 443 ssl http2;
      server_name deploy.yourdomain.com;

      # 证书路径由 Certbot 自动配置或手动指定
      # ssl_certificate /etc/letsencrypt/live/deploy.yourdomain.com/fullchain.pem;
      # ssl_certificate_key /etc/letsencrypt/live/deploy.yourdomain.com/privkey.pem;

      client_max_body_size 30M;

      # 关键配置：SSE 实时部署日志流必须关闭代理缓存与缓冲
      location /api/jobs/ {
          proxy_pass http://127.0.0.1:8000;
          proxy_http_version 1.1;
          proxy_set_header Connection '';
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;

          proxy_buffering off;
          proxy_cache off;
          proxy_read_timeout 600s;
      }

      # 静态页面与常规 API 请求
      location / {
          proxy_pass http://127.0.0.1:8000;
          proxy_http_version 1.1;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
          proxy_read_timeout 300s;
      }
  }

  启用该站点配置：

  sudo nginx -t
  sudo systemctl reload nginx

  #### 3. 申请 Let's Encrypt 免费 SSL 证书

  将域名解析到 VPS IP 后，执行 Certbot 自动配置证书：

  sudo certbot --nginx -d deploy.yourdomain.com

  ———

  ### 五、防火墙配置与访问验证

  确保服务器防火墙开放了 HTTP (80) 与 HTTPS (443) 端口：

  # 如果使用 UFW
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw reload

  在本地浏览器打开 https://deploy.yourdomain.com，即可看到 EdgeChat Web Deployer 界面：

  1. 填写 Cloudflare API Token 后，系统会自动探测账户资源与权限状态。
  2. 配置管理员账户、反代伪装域名及隐藏入口等参数。
  3. 点击 开始一键部署到 Cloudflare，页面将通过 SSE 实时显示打包与发布日志。

  ———

  ### 六、常用运维命令

  日常维护可进入 ~/Edgechat/deploy 目录执行以下命令：

  - 查看服务日志：docker compose logs -f
  - 重启服务：docker compose restart
  - 停止服务：docker compose down
  - 源码更新后重新构建：docker compose up -d --build
  - 手动清理历史构建缓存与数据：docker compose down -v && docker compose up -d --build

