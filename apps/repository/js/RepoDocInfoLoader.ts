import {DocMetaRef} from '../../../web/js/datastore/DocMetaRef';
import {Optional} from '../../../web/js/util/ts/Optional';
import {IListenablePersistenceLayer} from '../../../web/js/datastore/IListenablePersistenceLayer';
import {Logger} from '../../../web/js/logger/Logger';
import {Progress} from '../../../web/js/util/Progress';
import {ProgressBar} from '../../../web/js/ui/progress_bar/ProgressBar';
import {RepoDocInfoIndex} from './RepoDocInfoIndex';
import {RepoDocInfos} from './RepoDocInfos';
import {Dictionaries} from '../../../web/js/util/Dictionaries';
import {RepoDocInfo} from './RepoDocInfo';
import {DocMeta} from '../../../web/js/metadata/DocMeta';
import {DocMetaSnapshotEvent, SnapshotProgress, SnapshotUnsubscriber} from '../../../web/js/datastore/Datastore';
import {ElectronContextTypes} from '../../../web/js/electron/context/ElectronContextTypes';
import {Promises} from '../../../web/js/util/Promises';
import {PersistenceLayerManager} from '../../../web/js/datastore/PersistenceLayerManager';
import {PersistenceLayerManagerEvent} from '../../../web/js/datastore/PersistenceLayerManager';
import {NULL_FUNCTION} from '../../../web/js/util/Functions';
import {PersistenceLayer} from '../../../web/js/datastore/PersistenceLayer';
import {IEventDispatcher, SimpleReactor} from '../../../web/js/reactor/SimpleReactor';

const log = Logger.create();

export class RepoDocInfoLoader {

    private readonly persistenceLayerManager: PersistenceLayerManager;

    private readonly eventDispatcher: IEventDispatcher<RepoLoadEvent> = new SimpleReactor();

    constructor(persistenceLayerManager: PersistenceLayerManager) {
        this.persistenceLayerManager = persistenceLayerManager;
    }

    public addEventListener(listener: (event: RepoLoadEvent) => void): void {
        this.eventDispatcher.addEventListener(listener);
    }


    public async start() {

        this.persistenceLayerManager.addEventListener(event => {

            if (event.state === 'changed') {
                this.onPersistenceLayerChanged(event.persistenceLayer);
            }

        });

    }

    private onPersistenceLayerChanged(persistenceLayer: PersistenceLayer) {

        // FIXME: the disk datastore doesn't do its own snapshot by
        // default so we wouldn't get events by default... and the
        // cloud datastore DOES do it by default... maybe we have a
        // snapshotOnInit method to always require this behavior...

        let progressBar: ProgressBar | undefined;

        persistenceLayer.addDocMetaSnapshotEventListener(docMetaSnapshotEvent => {

            // console.log("FIXME: docMetaSnapshotEvent: ", docMetaSnapshotEvent);

            if (docMetaSnapshotEvent.batch) {
                console.log(`progress: ${docMetaSnapshotEvent.datastore} (consistency: ${docMetaSnapshotEvent.consistency}, batch.id: ${docMetaSnapshotEvent.batch!.id}, batch.terminated: ${docMetaSnapshotEvent.batch!.terminated}): ${docMetaSnapshotEvent.progress.progress}` );
            } else {
                console.log(`progress: ${docMetaSnapshotEvent.datastore} (consistency: ${docMetaSnapshotEvent.consistency}, NO BATCH): ${docMetaSnapshotEvent.progress.progress}` );
            }


            const eventHandler = async () => {

                if (!progressBar) {
                    progressBar = ProgressBar.create(false);
                }

                const repoDocInfoIndex: RepoDocInfoIndex = {};

                const {progress, docMetaMutations} = docMetaSnapshotEvent;

                for (const docMetaMutation of docMetaMutations) {

                    const docMeta = await docMetaMutation.docMetaProvider();
                    const docInfo = docMeta.docInfo;

                    const repoDocInfo = await this.loadDocMeta(docInfo.fingerprint, docMeta);

                    if (repoDocInfo && RepoDocInfos.isValid(repoDocInfo)) {
                        repoDocInfoIndex[repoDocInfo.fingerprint] = repoDocInfo;
                    }

                }

                progressBar.update(progress.progress);

                this.eventDispatcher.dispatchEvent({repoDocInfoIndex, progress});

                if (progress.progress === 100) {
                    progressBar.destroy();
                    progressBar = undefined;
                }

            };

            eventHandler()
                .catch(err => log.error("Could not handle snapshot: ", err));

        });

    }

    private async loadDocMetaFile(docMetaRef: DocMetaRef): Promise<RepoDocInfo | undefined> {

        if (! this.persistenceLayerManager) {
            throw new Error("No persistence layer");
        }

        let docMeta: DocMeta | undefined;

        try {

            const persistenceLayer = this.persistenceLayerManager.get();

            docMeta = await persistenceLayer.getDocMeta(docMetaRef.fingerprint);

            return this.loadDocMeta(docMetaRef.fingerprint, docMeta);

        } catch (e) {
            log.error("Unable to load DocMeta for " + docMetaRef.fingerprint, e);

            return undefined;
        }

    }

    private async loadDocMeta(fingerprint: string, docMeta?: DocMeta): Promise<RepoDocInfo | undefined> {

        if (docMeta !== undefined) {

            if (docMeta.docInfo) {

                return RepoDocInfos.convertFromDocInfo(docMeta.docInfo);

            } else {
                log.warn("No docInfo for file: ", fingerprint);
            }

        } else {
            log.warn("No DocMeta for fingerprint: " + fingerprint);
        }

        return undefined;

    }



    /**
     * Some of our documents might be broken and we should filter them to not
     * break the UI.
     *
     * @param repoDocInfoIndex
     */
    private async filterInvalid(repoDocInfoIndex: RepoDocInfoIndex) {

        const filtered = Object.values(repoDocInfoIndex)
            .filter(current => RepoDocInfos.isValid(current));

        return Dictionaries.toDict(filtered, (value) => value.fingerprint);

    }

}

export interface RepoLoadEvent {
    readonly repoDocInfoIndex: RepoDocInfoIndex;
    readonly progress: SnapshotProgress;
}
