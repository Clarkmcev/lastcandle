import Phaser from "phaser";
import "./style.css";
import { GameScene } from "./scene";
import { Session } from "./session";
import { UI } from "./ui";

let game: Phaser.Game | undefined;
let session: Session | undefined;

function connect(room: string, name: string): Session {
  session?.net.close();
  session = new Session(room, name);
  if (!game) {
    game = new Phaser.Game({
      type: Phaser.WEBGL,
      parent: "game",
      backgroundColor: "#030204",
      scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
      render: { antialias: true },
      scene: [],
    });
    game.scene.add("game", GameScene, true, { session });
  } else {
    game.scene.getScene("game")?.scene.restart({ session });
  }
  return session;
}

new UI(connect);

// A handle for poking at the game from the browser console.
(window as unknown as { lastcandle: object }).lastcandle = {
  get game() {
    return game;
  },
  get session() {
    return session;
  },
};
