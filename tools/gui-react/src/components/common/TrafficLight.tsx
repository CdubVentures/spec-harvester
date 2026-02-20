import { trafficColor } from '../../utils/colors';

export function TrafficLight({ color }: { color: string }) {
  return (
    <span className={`inline-block w-3 h-3 rounded-full ${trafficColor(color)}`} title={color} />
  );
}
