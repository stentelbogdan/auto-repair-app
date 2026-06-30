import Image from "next/image";

type LicensePlateProps = {
  plate?: string | null;
  className?: string;
  priority?: boolean;
};

export default function LicensePlate({
  plate,
  className = "",
  priority = false,
}: LicensePlateProps) {
  return (
    <div className={`relative h-[28px] w-[138px] ${className}`}>
      <Image
        src="/images/license-plates/ro.svg"
        alt="Număr înmatriculare"
        fill
        className="object-contain"
        priority={priority}
      />

      <span className="absolute left-[26px] top-1/2 -translate-y-1/2 whitespace-nowrap text-[20px] font-black uppercase tracking-[0.0em] text-black">
        {plate || "FĂRĂ NR."}
      </span>
    </div>
  );
}