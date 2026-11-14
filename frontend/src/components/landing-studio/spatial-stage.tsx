import { ShieldCheck, Monitor, Smartphone, Globe2, LockKeyhole, ArrowUpRight, Wifi, Check, Power } from "lucide-react";

/** Real DOM planes in shared perspective. Decorative connection illustration,
 * not a claim that the visitor has connected or that these are live servers. */
export function SpatialStage({ name, color, caption, image, material = "glass" }: { name: string; color: string; caption: string; image?: string; material?: string }) {
  if (image) return <div className="sn-spatial-image"><img src={image} alt=""/></div>;
  return <div className={`sn-spatial-stage sn-material-${material}`} style={{"--stage-accent":color} as React.CSSProperties} aria-label="Иллюстрация интерфейса подключения VPN">
    <div className="sn-spatial-floor" aria-hidden="true"><i/><i/><i/><i/><i/></div>
    <div className="sn-plane sn-plane-back" aria-hidden="true"><span/><span/><span/></div>
    <div className="sn-plane sn-plane-network" aria-hidden="true"><Globe2/><div className="sn-network-lines"><i/><i/><i/></div><span className="sn-network-point p1"/><span className="sn-network-point p2"/><span className="sn-network-point p3"/><span className="sn-network-point p4"/></div>
    <div className="sn-plane sn-plane-main">
      <div className="sn-demo-toolbar"><span className="sn-demo-logo"><ShieldCheck size={19}/>{name}</span><span className="sn-demo-dots"><i/><i/><i/></span></div>
      <div className="sn-demo-layout"><div className="sn-demo-sidebar" aria-hidden="true"><ShieldCheck/><Globe2/><Monitor/><LockKeyhole/><i/></div><div className="sn-demo-content"><div className="sn-demo-shield"><ShieldCheck size={44} strokeWidth={1.1}/></div><strong>{caption || "Ваше личное пространство"}</strong><span className="sn-demo-subtitle">VPN · {name}</span><div className="sn-demo-connection"><span/><i/><span/><i/><span/></div><div className="sn-demo-bottom"><span><Monitor size={15}/></span><span><Smartphone size={15}/></span><span><Wifi size={15}/></span><span><Check size={15}/></span></div></div></div>
    </div>
    <div className="sn-plane sn-plane-phone"><div className="sn-phone-camera"/><span className="sn-phone-time">9:41</span><div className="sn-phone-shield"><ShieldCheck size={28}/></div><strong>{name}</strong><span className="sn-phone-line"/><div className="sn-phone-power"><Power size={23}/></div><div className="sn-phone-footer"><i/><i/><i/></div></div>
    <div className="sn-plane sn-plane-label"><LockKeyhole size={18}/><span>{name} VPN</span><ArrowUpRight size={17}/></div>
    <div className="sn-plane sn-plane-orbit" aria-hidden="true"><Globe2 size={29}/></div>
  </div>;
}
