import { Input } from "@nextui-org/react";

export interface TextInputProps {
    onChange?: (value: string) => void,
    value?: string,
    label: string,
    readOnly?: boolean,
}

export const TextField: React.FC<TextInputProps> = ({ onChange, label, ...others }) => {
    return (
        <div>
            <Input labelLeft={label} onChange={event => { if (onChange !== undefined) onChange(event.target.value) }} {...others} />
        </div>
    )
}
