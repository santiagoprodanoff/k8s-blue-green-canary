import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter } from 'k6/metrics';

export let canaryHits = new Counter('canary_hits');
export let mainHits = new Counter('main_hits');

const MINIKUBE_HOST = __ENV.MINIKUBE_HOST || '127.0.0.1:8080';
const HOST_HEADER = __ENV.HOST_HEADER || 'app.local';
const FORCE_CANARY_BY_HEADER = (__ENV.FORCE_CANARY_BY_HEADER === 'true'); // set to "true" to force header
const URL = `http://${MINIKUBE_HOST}/`;

export let options = {
  vus: __ENV.K6_VUS ? Number(__ENV.K6_VUS) : 50,
  duration: __ENV.K6_DURATION || '20s',
};

export default function () {
  const headers = { Host: HOST_HEADER };
  if (FORCE_CANARY_BY_HEADER) {
    headers['X-Canary'] = 'true';
  }

  const res = http.get(URL, { headers: headers });

  check(res, {
    'status is 200': (r) => r.status === 200,
  });

  const body = (res.body || '').toLowerCase();

  const isCanary =
    body.includes('canary') ||
    (body.includes('color:') && body.includes('yellow')) ||
    (body.includes('version') && (body.includes('canary') || body.includes('canary-')));

  if (isCanary) {
    canaryHits.add(1);
  } else {
    mainHits.add(1);
  }

  sleep(0.05);
}