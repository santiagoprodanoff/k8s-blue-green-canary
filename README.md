# K8s Blue/Green with LoadBalancer & Canary using nginx-ingress

**Overview**
- Two Deployments: `app-blue` and `app-green` (same image). Each sets env vars: `VERSION` and `COLOR`.
- Service `app-service` (type: `LoadBalancer`) initially selects the blue pods.
- The container substitutes `VERSION`, `COLOR` and `POD_IP` into `index.html` at start.
- Nginx access log is sent to container stdout so you can inspect which pod served the request with `kubectl logs`.

**Prerequisites**
- minikube (>= 1.20)
- kubectl
- Docker
- On Apple Silicon (M1/M2) build images with `--platform=linux/arm64`.

**Quick glossary**
- `demo/webserver:latest` — the image name used in manifests. Tooling will often display this as `docker.io/demo/webserver:latest` (the `docker.io/` prefix is implicit).
- `minikube tunnel` — binds LoadBalancer IPs on your host (requires sudo and must run in its own terminal).
- Blue/Green = traffic flip by changing Service selector to `color: blue|green`.
- Canary = percentage-based routing at the Ingress layer using nginx-ingress annotations, routed to a dedicated canary Service.


## Manual steps (minikube)

1) Start minikube (adjust resources if needed)
```bash
minikube start --driver=docker
```

2) Build image and load it to minikube
```bash
docker build --platform=linux/arm64 -t demo/webserver:latest ./app
minikube image load demo/webserver:latest
```

Sanity checks:
```bash
minikube image ls | grep demo/webserver
docker image ls | grep demo/webserver
```

3) Create namespace and apply Blue/Green manifests
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
- If pods show `ErrImagePull` / `ImagePullBackOff`:
  - Ensure the image was loaded into minikube (`minikube image ls`).
  - Prevent remote pulls for local testing:
  ```bash
  kubectl -n demo patch deployment app-blue  --type='json' \
    -p='[{"op":"add","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'
  kubectl -n demo patch deployment app-green --type='json' \
    -p='[{"op":"add","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'
  kubectl -n demo rollout restart deployment app-blue app-green
  ```

5) Make the LoadBalancer reachable (minikube)
Start the tunnel in a separate terminal (keep it open):
```bash
sudo minikube tunnel
```
Then check the Service:
```bash
kubectl -n demo get svc app-service
```
The `EXTERNAL-IP` column should show the LoadBalancer IP once tunnel binds.

6) Test the app (Blue/Green)
- If using minikube tunnel and LoadBalancer bound to host:80:
```bash
curl http://127.0.0.1/
```

7) Flip Blue -> Green (single atomic API call)
```bash
kubectl -n demo patch svc app-service --type='merge' \
  -p '{"spec":{"selector":{"app":"webapp","color":"green"}}}'
```
Verify:
```bash
curl http://127.0.0.1/
```

8) Rollback (Green -> Blue)
```bash
kubectl -n demo patch svc app-service --type='merge' \
  -p '{"spec":{"selector":{"app":"webapp","color":"blue"}}}'
```

9) Logs (request logging)
- Inspect which pod served requests:
```bash
kubectl -n demo get pods -l app=webapp -o wide
kubectl -n demo logs -l app=webapp --tail=200
# or follow:
kubectl -n demo logs -l app=webapp -f
```


## Canary deployment (coexists with Blue/Green)

This repo demonstrates both strategies side‑by‑side. 
Blue/Green uses `app-service` and a selector flip. 
Canary uses `app-canary` + `app-canary-service` and an Ingress with nginx-ingress canary annotations to split traffic.

### Apply Canary resources
1) Enable nginx ingress addon (minikube):
```bash
minikube addons enable ingress
```

2) Deploy canary pods & service:
```bash
kubectl apply -f infra/deployment-canary.yaml
kubectl apply -f infra/service-canary.yaml
```

3) Apply Ingresses (blue/green + canary):
```bash
kubectl apply -f infra/ingress-blue-green.yaml
kubectl apply -f infra/ingress-canary.yaml
```

4) Ensure canary uses local image (if needed):
```bash
kubectl -n demo patch deployment app-canary --type='json' \
  -p='[{"op":"add","path":"/spec/template/spec/containers/0/imagePullPolicy","value":"IfNotPresent"}]'

kubectl -n demo rollout restart deployment app-canary
```

---

### Testing the Canary (deterministic + probabilistic)

Important: Ingress rules are matched by Host header. When testing the nginx ingress controller directly (port-forward or nodePort) set the Host header or map `app.local` to the test host.

A) Make the ingress controller reachable (recommended: port-forward)
1. Find the service and port-forward it to localhost:8080 (keep this terminal open):
```bash
kubectl -n ingress-nginx get svc
# then (replace svc name if different)
kubectl -n ingress-nginx port-forward svc/ingress-nginx-controller 8080:80
```

2. Deterministic (header-based) smoke test — always hit canary
- Test canary (header forces canary regardless of weight):
```bash
curl -v -H "Host: app.local" -H "X-Canary: true" http://127.0.0.1:8080/
```

- Test normal traffic (no header — should go to blue/green main):
```bash
curl -v -H "Host: app.local" http://127.0.0.1:8080/
```

B) Deterministic k6 test (all requests hit canary)
```bash
export MINIKUBE_HOST=127.0.0.1:8080
export HOST_HEADER=app.local
export FORCE_CANARY_BY_HEADER=true
k6 run -e MINIKUBE_HOST=$MINIKUBE_HOST -e HOST_HEADER=$HOST_HEADER -e FORCE_CANARY_BY_HEADER=$FORCE_CANARY_BY_HEADER infra/k6-canary-test.js
```

C) Increase canary-weight and run probabilistic tests
1. Set canary-weight to 20% (example):
```bash
kubectl -n demo patch ingress app-ingress-canary --type='merge' \
  -p '{"metadata":{"annotations":{"nginx.ingress.kubernetes.io/canary-weight":"20"}}}'
```

2. Probabilistic k6 run (do NOT force header):
```bash
export MINIKUBE_HOST=127.0.0.1:8080
export HOST_HEADER=app.local
export FORCE_CANARY_BY_HEADER=false
k6 run -e MINIKUBE_HOST=$MINIKUBE_HOST -e HOST_HEADER=$HOST_HEADER -e FORCE_CANARY_BY_HEADER=$FORCE_CANARY_BY_HEADER infra/k6-canary-test.js
```

3. Inspect k6 counters:
- `canary_hits` and `main_hits` are emitted by the script. Compute:
  `observed_fraction = canary_hits / (canary_hits + main_hits)`
