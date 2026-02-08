import { Bonjour, type Service } from "bonjour-service";
import { hostname } from "node:os";

export interface MdnsHandle {
  stop: () => void;
}

export function startMdnsAdvertisement(port: number): MdnsHandle {
  const hostToken = hostname()
    .toLowerCase()
    .split(".")[0]
    ?.replace(/[^a-z0-9-]/g, "-")
    .replace(/^-+|-+$/g, "");
  const defaultServiceName = `clubscore-lan-${hostToken || "host"}-${process.pid}`;
  const serviceName = process.env.CLUBSCORE_MDNS_NAME ?? defaultServiceName;

  const bonjour = new Bonjour();
  const service: Service = bonjour.publish({
    name: serviceName,
    type: "clubscore",
    protocol: "tcp",
    port,
    txt: {
      api: "true",
      path: "/api/discovery",
      version: "v1",
    },
  });

  service.on("error", (error: unknown) => {
    const message =
      error instanceof Error ? error.message : "Unknown mDNS publish error";
    console.warn(`[clubscore-mdns] ${message}`);
  });

  return {
    stop: () => {
      if (typeof service.stop === "function") {
        service.stop(() => {
          bonjour.destroy();
        });
      } else {
        bonjour.destroy();
      }
    },
  };
}
