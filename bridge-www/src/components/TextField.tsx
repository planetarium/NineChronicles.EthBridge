import { Input } from "@nextui-org/react";

export interface TextInputProps {
    onChange: (value: string) => void,
    value?: string,
    label: string,
}

export const TextField: React.FC<TextInputProps> = ({ onChange, label, ...others }) => {
    return (
        <div>
            <Input labelLeft={label} onChange={event => { onChange(event.target.value) }} {...others} />
        </div>
    )
}
