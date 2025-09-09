import { AsemicGroup } from '../parser/Parser';
export default abstract class AsemicRenderer {
    abstract setup(): Promise<void>;
    abstract render(groups: AsemicGroup[]): void;
}
