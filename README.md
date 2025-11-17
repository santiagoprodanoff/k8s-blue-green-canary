# Kubernetes Blue/Green with LoadBalancer (minikube)

Overview
- Two Deployments: `app-blue` and `app-green` (same image). Each sets env vars: `VERSION` and `COLOR`.
- Service `app-service` (type: `LoadBalancer`) initially selects the blue pods.
- To switch traffic to green you patch the Service selector (one `kubectl` call).
- The container substitutes `VERSION`, `COLOR` and `POD_IP` into `index.html` at start.
- Nginx access log is sent to container stdout so you can inspect which pod served the request with `kubectl logs`.

Prerequisites
- minikube (>= 1.20)
- kubectl
- Docker
- On Apple Silicon (M1/M2) build images with `--platform=linux/arm64`.

Quick glossary
- `demo/webserver:latest` — the image name used in manifests. Tooling will often display this as `docker.io/demo/webserver:latest` (the `docker.io/` prefix is implicit).
- `minikube tunnel` — binds LoadBalancer IPs on your host (requires sudo and must run in its own terminal).
- Blue/Green = traffic flip by changing Service selector to `color: blue|green`.

Manual steps (minikube)

1) Start minikube (adjust resources for your machine if needed):
```bash
minikube start --driver=docker
```

2) Build the image and load it to minikube
```bash
docker build --platform=linux/arm64 -t demo/webserver:latest ./app 
minikube image load demo/webserver:latest

# sanity checks
minikube image ls | grep demo/webserver
docker image ls | grep demo/webserver
```

3) Create namespace and apply core Blue/Green manifests
```bash
kubectl apply -f infra/namespace.yaml
kubectl apply -f infra/deployments-blue-green.yaml
kubectl apply -f infra/service-loadbalancer.yaml
```

4) Quick checks & troubleshooting
- Check pods:
```bash
kubectl -n demo get pods -o wide
```

- If pods are stuck `ErrImagePull` / `ImagePullBackOff`:
  - Ensure the image was loaded into minikube (`minikube image ls`).
  - Prevent unnecessary remote pulls:
```bash
kubectl -n demo patch deployment app-blue  --type='json' -p='[{"op":"add","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'
kubectl -n demo patch deployment app-green --type='json' -p='[{"op":"add","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'
# then force a restart
kubectl -n demo rollout restart deployment app-blue app-green
```

5) Make the LoadBalancer reachable (minikube)
Start the minikube tunnel in a separate terminal (keep it open):
```bash
sudo minikube tunnel
```
Then check the Service:
```bash
kubectl -n demo get svc app-service
```
The `EXTERNAL-IP` column should show the LoadBalancer IP once tunnel binds.

6) Test the app
```bash
curl http://127.0.0.1/
```

7) Flip Blue -> Green (single atomic API call)
```bash
kubectl -n demo patch svc app-service --type='merge' \
  -p '{"spec":{"selector":{"app":"webapp","color":"green"}}}'
```
Verify endpoints and responses:
```bash
kubectl -n demo get endpoints app-service -o wide
curl http://127.0.0.1/   # should now show the green VERSION/COLOR
```

8) Rollback (Green -> Blue)
```bash
kubectl -n demo patch svc app-service --type='merge' \
  -p '{"spec":{"selector":{"app":"webapp","color":"blue"}}}'
```

9) Logs (request logging)
- Nginx access logs are forwarded to container stdout. To see which pod served requests:
```bash
kubectl -n demo get pods -l app=webapp -o wide
kubectl -n demo logs -l app=webapp --tail=200
# or follow:
kubectl -n demo logs -l app=webapp -f
```
