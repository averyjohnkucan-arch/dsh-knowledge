export interface NumberSliderProps {
    label: string;
    value: number;
    min: number;
    max: number;
    step: number;
    onChange: (value: number) => void;
    disabled?: boolean;
}
export declare function normalizeSliderValue(raw: string, min: number, max: number, step: number): number | undefined;
/** Draft text stays editable; only valid, bounded numbers reach saved settings. */
export declare function NumberSlider(props: NumberSliderProps): JSX.Element;
//# sourceMappingURL=NumberSlider.d.ts.map