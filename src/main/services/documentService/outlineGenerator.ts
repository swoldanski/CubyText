import {
  type BlockyDocument,
  BlockElement,
  BlockyNode,
  textTypePrecedence,
} from "blocky-data";
import { isObject, isString, isUndefined } from "lodash-es";
import type { OutlineNode } from "@pkg/common/outlineTree";
import { DocumentService } from "@pkg/main/services/documentService";

export interface OutlineGeneratorOptions {
  document: BlockyDocument;
  referencesCollector?: OutlineNode[];
}

export class OutlineGenerator {
  #nodeStack: OutlineNode[] = [];
  readonly document: BlockyDocument;
  constructor(readonly options: OutlineGeneratorOptions) {
    this.document = options.document;
  }

  get title(): string {
    return this.document.title.getTextModel("textContent")?.toString() ?? "";
  }

  async generate(): Promise<OutlineNode> {
    this.#nodeStack.push({
      id: "title",
      title: this.title || "Untitled document",
      priority: 0,
      nodeType: "normal",
      children: [],
    });
    await this.#generateHeadingOutline(this.document.body);
    return this.#nodeStack[0];
  }

  async #generateHeadingOutline(container: BlockyNode) {
    let ptr = container.firstChild;
    while (ptr) {
      if (ptr instanceof BlockElement && ptr.nodeName === "Text") {
        const textType = ptr.getAttribute("textType");
        const precedence = textTypePrecedence(textType);
        if (isString(textType) && precedence > 0) {
          const title = ptr.getTextModel("textContent")?.toString();
          if (title) {
            // filter the empty title
            let topNode = this.#nodeStack[this.#nodeStack.length - 1];

            const newNode: OutlineNode = {
              id: ptr.id,
              title,
              priority: precedence,
              nodeType: textType,
              children: [],
            };

            if (precedence < topNode.priority) {
              topNode = this.#popToPriority(precedence);
            }

            if (precedence === topNode.priority) {
              const parent = this.#nodeStack[this.#nodeStack.length - 2];
              parent.children.push(newNode);
              this.#nodeStack[this.#nodeStack.length - 1] = newNode;
            } else if (precedence > topNode.priority) {
              this.#nodeStack.push(newNode);
              topNode.children.push(newNode);
            }
          }
        } else {
          await this.#findReferences(ptr);
        }
      }
      ptr = ptr.nextSibling;
    }
  }

  async #findReferences(blockElement: BlockElement) {
    const textModel = blockElement.getTextModel("textContent");
    if (!textModel) {
      return;
    }
    const documentService = DocumentService.get();
    for (const op of textModel.delta.ops) {
      if (isObject(op.insert)) {
        if (op.insert.type === "reference") {
          const topNode = this.#nodeStack[this.#nodeStack.length - 1];
          const id = op.insert.docId as string;

          // TODO(optimize): batch query
          const title = await documentService.getDocTitle(id);
          if (isUndefined(title)) {
            continue;
          }

          const newNode: OutlineNode = {
            id: "Ref-" + id,
            title,
            priority: -100,
            nodeType: "reference",
            children: [],
          };
          const result = this.#pushIfNotExist(topNode.children, newNode);
          if (result && this.options.referencesCollector) {
            this.options.referencesCollector.push(newNode);
          }
        }
      }
    }
  }

  #pushIfNotExist(outlines: OutlineNode[], newNode: OutlineNode): boolean {
    const exist = outlines.find((outline) => outline.id === newNode.id);
    if (exist) {
      return false;
    }
    outlines.push(newNode);
    return true;
  }

  #popToPriority(priority: number): OutlineNode {
    while (
      this.#nodeStack.length > 0 &&
      this.#nodeStack[this.#nodeStack.length - 1].priority > priority
    ) {
      this.#nodeStack.pop();
    }
    return this.#nodeStack[this.#nodeStack.length - 1];
  }
}
