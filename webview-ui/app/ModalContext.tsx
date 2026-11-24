// The one dialog open at a time, and the way any part of the page opens or closes it.
import { createContext, useContext, type Dispatch, type SetStateAction } from "react";
import type { Modal } from "../components/Modals";

export const ModalContext = createContext<Dispatch<SetStateAction<Modal | null>>>(() => undefined);

export const useSetModal = (): Dispatch<SetStateAction<Modal | null>> => useContext(ModalContext);
