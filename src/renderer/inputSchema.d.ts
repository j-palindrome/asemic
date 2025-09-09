import { z } from 'zod';
export declare const inputSchema: z.ZodObject<{
    params: z.ZodRecord<z.ZodString, z.ZodObject<{
        type: z.ZodLiteral<"number">;
        value: z.ZodNumber;
        max: z.ZodNumber;
        min: z.ZodNumber;
        exponent: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        exponent?: number;
        type?: "number";
        value?: number;
        max?: number;
        min?: number;
    }, {
        exponent?: number;
        type?: "number";
        value?: number;
        max?: number;
        min?: number;
    }>>;
    presets: z.ZodRecord<z.ZodString, z.ZodRecord<z.ZodString, z.ZodObject<{
        type: z.ZodLiteral<"number">;
        value: z.ZodNumber;
        max: z.ZodNumber;
        min: z.ZodNumber;
        exponent: z.ZodDefault<z.ZodOptional<z.ZodNumber>>;
    }, "strip", z.ZodTypeAny, {
        exponent?: number;
        type?: "number";
        value?: number;
        max?: number;
        min?: number;
    }, {
        exponent?: number;
        type?: "number";
        value?: number;
        max?: number;
        min?: number;
    }>>>;
}, "strip", z.ZodTypeAny, {
    params?: Record<string, {
        exponent?: number;
        type?: "number";
        value?: number;
        max?: number;
        min?: number;
    }>;
    presets?: Record<string, Record<string, {
        exponent?: number;
        type?: "number";
        value?: number;
        max?: number;
        min?: number;
    }>>;
}, {
    params?: Record<string, {
        exponent?: number;
        type?: "number";
        value?: number;
        max?: number;
        min?: number;
    }>;
    presets?: Record<string, Record<string, {
        exponent?: number;
        type?: "number";
        value?: number;
        max?: number;
        min?: number;
    }>>;
}>;
export type InputSchema = z.infer<typeof inputSchema>;
