import { Bonjour, type Service } from "bonjour-service";

export interface MdnsHandle {
  stop: () => void;
}

export function startMdnsAdvertisement(port: number): MdnsHandle {
  const bonjour = new Bonjour();
  const service: Service = bonjour.publish({
    name: "clubscore-lan",
    type: "clubscore",
    protocol: "tcp",
    port,
    txt: {
      api: "true",
      path: "/api/discovery",
      version: "v1",
    },
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
