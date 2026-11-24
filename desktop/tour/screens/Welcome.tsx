import { Companion } from "../../../companion/figure/Companion";
import { Footer } from "../components/Footer";

export function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <div className="screen">
      <div className="body center">
        <Companion mood="hello" name="Roger" size={96} />
        <h1>Welcome to Airband</h1>
        <p className="lede">I'm Roger. I keep an ear on your AI coding chats and let you know the moment one needs you.</p>
      </div>
      <Footer at={1}>
        <button className="primary" onClick={onStart}>
          Get started
        </button>
      </Footer>
    </div>
  );
}
